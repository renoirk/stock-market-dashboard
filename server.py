#!/usr/bin/env python3
"""
StockView Local Proxy Server
Yahoo Finance API CORS 우회용 로컬 프록시
실행: python server.py
"""
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError
import json, os, sys, ssl

# 로컬 프록시용 SSL 컨텍스트 (인증서 검증 생략)
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode    = ssl.CERT_NONE

PORT       = 8080
YAHOO_BASE = 'https://query1.finance.yahoo.com'
HEADERS    = {
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124',
    'Accept':          'application/json, text/plain, */*',
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8',
    'Accept-Encoding': 'identity',
    'Referer':         'https://finance.yahoo.com',
    'Origin':          'https://finance.yahoo.com',
}

class ProxyHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/api/'):
            self._proxy()
        else:
            super().do_GET()

    def _proxy(self):
        yahoo_path = self.path[4:]          # '/api/v8/...' -> '/v8/...'
        url        = YAHOO_BASE + yahoo_path
        req        = Request(url, headers=HEADERS)
        try:
            with urlopen(req, context=SSL_CTX, timeout=12) as r:
                body = r.read()
        except HTTPError as e:
            body = e.read()   # Yahoo 에러 응답도 JSON으로 전달
        except URLError as e:
            body = json.dumps({'error': str(e.reason)}).encode()
        except Exception as e:
            body = json.dumps({'error': str(e)}).encode()

        # 항상 200 반환 -- 클라이언트가 JSON 파싱으로 오류 판별
        self.send_response(200)
        self.send_header('Content-Type',                 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin',  '*')
        self.send_header('Access-Control-Allow-Methods', 'GET')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        if len(args) >= 2:
            path   = args[0].split()[1] if args[0] else ''
            status = args[1]
            icon   = '📡' if path.startswith('/api') else '📄'
            print(f'  {icon} [{status}] {path}')


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    srv = HTTPServer(('localhost', PORT), ProxyHandler)
    print(f'\n  StockView 서버 실행 중 -> http://localhost:{PORT}')
    print(f'  Yahoo Finance 프록시: /api/... -> {YAHOO_BASE}/...')
    print(f'  종료: Ctrl+C\n')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\n서버 종료')
        sys.exit(0)
