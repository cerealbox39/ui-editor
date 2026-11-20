"""Serve the try-it demo dashboard with the UI Editor overlay.

Usage: python3 demo/server.py [port]   (default 8080)
"""
import http.server
import pathlib
import sys

DEMO = pathlib.Path(__file__).resolve().parent
REPO = DEMO.parent
OVERLAY = {'/ui-editor/ui-editor.js': REPO / 'ui-editor.js', '/ui-editor/ui-editor.css': REPO / 'ui-editor.css'}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DEMO), **kwargs)

    def do_GET(self):
        path, _, query = self.path.partition('?')
        if path == '/' and 'pin=1' not in query.split('&'):
            self.send_response(302)
            self.send_header('Location', '/?' + '&'.join(filter(None, [query, 'pin=1'])))
            self.end_headers()
            return
        if path.endswith('.py'):
            self.send_error(404)
            return
        super().do_GET()

    def translate_path(self, path):
        clean = path.split('?', 1)[0].split('#', 1)[0]
        if clean in OVERLAY:
            return str(OVERLAY[clean])
        return super().translate_path(path)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    http.server.ThreadingHTTPServer(('0.0.0.0', port), Handler).serve_forever()
