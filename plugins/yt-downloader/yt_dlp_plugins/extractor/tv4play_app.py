"""TV4 Play support for YT Downloader.

yt-dlp's own TV4 extractor only knows the old numeric links and never logs in. Current links look
like https://www.tv4play.se/video/<20 hex chars>/<slug>, and the playback API needs a login token
(a JWT in the `x-jwt` header) even for free episodes. This extractor reads that login from the
browser cookies the app passes with --cookies-from-browser and asks for the stream without DRM.
Videos TV4 marks as DRM-protected are refused, never decrypted.
"""
import base64
import json
import time
import urllib.parse

from yt_dlp.extractor.common import InfoExtractor
from yt_dlp.utils import (
    ExtractorError,
    bool_or_none,
    int_or_none,
    parse_iso8601,
    traverse_obj,
    url_or_none,
)

_COOKIE_URLS = ('https://www.tv4play.se/', 'https://tv4play.se/', 'https://auth.tv4.a2d.tv/', 'https://a2d.tv/')
_HEADERS = {'Origin': 'https://www.tv4play.se', 'Referer': 'https://www.tv4play.se/'}
_NEED_LOGIN = ('TV4 Play needs you to be logged in. Open Settings (gear icon) and paste your TV4 Play login, '
               'or choose the browser where you are logged in to tv4play.se.')


class TV4PlayAppIE(InfoExtractor):
    IE_NAME = 'tv4play:app'
    IE_DESC = 'TV4 Play (current links, with browser login)'
    _VALID_URL = r'https?://(?:www\.)?tv4play\.se/(?:[^?#]+/)?(?P<id>[0-9a-f]{20})(?=[/?#]|$)'
    _TESTS = [{
        'url': 'https://www.tv4play.se/video/6f623894d2a4feff9cb5/avsnitt-1-robinson-har-finns-inte-plats-for-alla',
        'only_matching': True,
    }]

    @staticmethod
    def _jwt_expiry(token):
        try:
            payload = token.split('.')[1]
            return json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4))).get('exp')
        except Exception:
            return None

    def _login_cookies(self):
        cookies = {}
        for url in _COOKIE_URLS:
            for name, morsel in self._get_cookies(url).items():
                if morsel.value:
                    cookies[name] = urllib.parse.unquote(morsel.value)
        return cookies

    def _access_token(self, video_id):
        cookies = self._login_cookies()
        # A still-valid access token in the cookies can be used as is.
        for name, value in cookies.items():
            if 'refresh' not in name.lower() and value.startswith('eyJ') and value.count('.') == 2:
                expiry = self._jwt_expiry(value)
                if expiry and expiry > time.time() + 60:
                    return value
        # Otherwise trade a refresh token for a new access token, as the TV4 Play website does: from the
        # browser cookies, or the one pasted in the app's Settings (Chrome on Windows locks its cookies).
        refresh_tokens = [v for n, v in cookies.items() if 'refresh' in n.lower()]
        refresh_tokens += self._configuration_arg('token', [], casesense=True)
        for value in refresh_tokens:
            expiry = self._jwt_expiry(value)
            if expiry and expiry < time.time():
                self.report_warning('The saved TV4 Play login has expired.', video_id)
                self._login_rejected = True
                continue
            try:
                token = self._download_json(
                    'https://auth.tv4.a2d.tv/v2/auth/token', video_id, 'Logging in to TV4 Play',
                    data=json.dumps({
                        'grant_type': 'refresh_token',
                        'refresh_token': value,
                        'profile_id': 'default',
                        'is_child': False,
                    }).encode(),
                    headers={**_HEADERS, 'Content-Type': 'application/json', 'client-name': 'tv4-web'},
                ).get('access_token')
            except ExtractorError as e:
                self.report_warning(f'TV4 Play rejected the login: {e.orig_msg}', video_id)
                self._login_rejected = True
                continue
            if token:
                return token
        return None

    def _real_extract(self, url):
        video_id = self._match_id(url)
        self._login_rejected = False
        token = self._access_token(video_id)
        headers = dict(_HEADERS)
        if token:
            headers['x-jwt'] = f'Bearer {token}'

        data = self._download_json(
            f'https://playback2.a2d.tv/play/{video_id}', video_id, 'Downloading playback info',
            headers=headers, expected_status=(400, 401, 403, 404), query={
                'service': 'tv4play',
                'device': 'browser',
                'protocol': 'hls,dash',
                'drm': '',  # ask for the unprotected stream
                'browser': 'GoogleChrome',
                'capabilities': 'live-drm-adstitch-2,yospace3',
            })

        error = data.get('errorCode')
        if error == 'LOGIN_REQUIRED':
            raise ExtractorError(
                _NEED_LOGIN if not token and not self._login_rejected else
                'TV4 Play did not accept your login. Log in at tv4play.se again, then paste a fresh '
                'TV4 Play login in Settings (gear icon).', expected=True)
        if error:
            raise ExtractorError(f'TV4 Play: {data.get("message") or error}', expected=True)

        info = data.get('metadata') or {}
        if info.get('isDrmProtected'):
            self.report_drm(video_id)

        manifest_url = traverse_obj(data, ('playbackItem', 'manifestUrl', {url_or_none}))
        if not manifest_url:
            raise ExtractorError('TV4 Play did not return a video stream for this link.', expected=True)
        formats, subtitles = self._extract_m3u8_formats_and_subtitles(
            manifest_url, video_id, 'mp4', m3u8_id='hls')
        for sub in traverse_obj(data, ('playbackItem', 'subs', lambda _, v: url_or_none(v['url']))):
            subtitles.setdefault(sub.get('language') or 'sv', []).append({'url': sub['url'], 'ext': 'vtt'})

        return {
            'id': video_id,
            'formats': formats,
            'subtitles': subtitles,
            **traverse_obj(info, {
                'title': ('title', {str}),
                'description': ('description', {str}),
                'timestamp': ('broadcastDateTime', {parse_iso8601}),
                'duration': ('duration', {int_or_none}),
                'thumbnail': ('image', {url_or_none}),
                'is_live': ('isLive', {bool_or_none}),
                'series': ('seriesTitle', {str}),
                'season_number': ('seasonNumber', {int_or_none}),
                'episode_number': ('episodeNumber', {int_or_none}),
            }),
        }
