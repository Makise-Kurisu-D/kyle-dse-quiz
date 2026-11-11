"""Independent, local-only redesign browser regression (Python standard library).

Run with an installed Chromium-family browser, without Playwright or production data:
  python3 -B tests/redesign_browser.py --suite all
  python3 -B tests/redesign_browser.py --suite routes --screenshots --artifacts /tmp/dse-redesign

Each journey uses a fresh incognito browser context. The accounts suite deliberately
switches both synthetic accounts in ONE context to test same-origin isolation.
Only allowlisted public source files are served. Question/paper/image/auth/sync data
are generated below; nested repositories, existing records, browser profiles and
external production services are never read. Product files and older tests are
never changed. Functional IDs/data attributes, not old appearance/theme APIs, are
used for interaction. A small RFC6455/CDP client avoids installing browser packages.
"""
from __future__ import annotations

import argparse
import base64
import copy
import hashlib
import json
import mimetypes
import os
import pathlib
import queue
import re
import shutil
import socket
import struct
import subprocess
import tempfile
import threading
import time
import traceback
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parents[1]
ACCOUNTS = {"kyle": ["chem", "bio", "math"], "yeelam": ["math", "m2", "physics"]}
NAMES = {"chem": "化學", "bio": "生物", "math": "數學", "m2": "數學延伸2", "physics": "物理"}
PASSWORD = "synthetic-valid-password"
MANIFEST = {
    "version": "0123456789abcdef", "pages": 3, "page_sizes": [[600, 840]] * 3,
    "sections": [{"label": "合成總結", "page": 1}, {"label": "合成卷一", "page": 2}],
    "mistakes": [{"label": "MC1", "question_id": "MC1", "page": 2, "x": .25, "y": .3},
                 {"label": "Q1(a)", "question_id": "Q1", "page": 3, "x": .65, "y": .5}],
}


def fixture_item(code, number, kind="mc"):
    item = {
        "id": f"{code}-2022-{'mc' if kind == 'mc' else 'q'}-{number}",
        "kind": kind, "topic": "T1" if number == 1 or kind == "mc" else "T2",
        "year": "2022", "paper": "卷一", "qref": f"MC{number}" if kind == "mc" else f"Q{number}(a)",
        "stem": f"合成物質{'甲' if number == 1 else '乙'}的必要條件",
        "stemFull": f"合成功能測試題目 {number}：判斷必要條件並解釋原因。這不是任何真實試卷。",
        "marks": 1 if kind == "mc" else 2, "lost": 1 if kind == "mc" else 2,
        "correctOpt": "A" if kind == "mc" else "", "correct": "合成參考：必要條件成立。",
        "option": "B" if kind == "mc" else "", "deduct": "合成錯因：漏寫必要條件。",
        "my": [["合成原答", True]], "points": "先指出必要條件，再完整解釋原因。",
        "checks": ["指出必要條件", "解釋原因"],
    }
    if kind == "mc":
        item["options"] = ["必要條件成立", "缺少必要條件", "無關條件", "資料不足"]
        if number == 1:
            item["figures"] = [{"path": f"images/{code}-2022-fig-synthetic.jpg", "alt": "合成題目圖", "width": 600, "height": 840}]
    else:
        item["answerFields"] = ["必要條件", "原因"]
        item["practiceRubric"] = {"version": 1, "groups": [
            {"id": "condition", "marks": 1, "all": [0]}, {"id": "reason", "marks": 1, "all": [1]}]}
    return item


def fixture_bank(account="kyle"):
    return {"subjects": {code: {"name": NAMES[code], "topics": [
        {"code": "T1", "name": "合成條件與概念"}, {"code": "T2", "name": "合成進階概念"}],
        "items": [fixture_item(code, 1), fixture_item(code, 2), fixture_item(code, 1, "sub"), fixture_item(code, 2, "sub")]}
        for code in ACCOUNTS[account]}}


def fixture_catalog(account="kyle"):
    return {"subjects": {code: ["2022"] for code in ACCOUNTS[account]},
            "papers": {code: {"2022": {"title": "2022 合成批改卷", "pages": 3,
                "assessment": {"earned": 7, "total": 10, "scope": "合成卷一", "components": [],
                "boundaries": [{"level": "4", "minimumPercent": 60}, {"level": "5", "minimumPercent": 80}]}}}
                for code in ACCOUNTS[account]}}


def synthetic_page(number=1):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="840" viewBox="0 0 600 840">'
            '<rect width="600" height="840" fill="#fafaf7"/><g font-family="sans-serif" fill="#24382f">'
            f'<text x="36" y="60" font-size="24">SYNTHETIC PAPER / PAGE {number}</text>'
            '<text x="36" y="100" font-size="14">Local regression fixture. No examination or personal data.</text>'
            '<rect x="36" y="160" width="330" height="460" fill="#f0f2eb" stroke="#a4b4a2"/>'
            '<path d="M60 220h260m-260 50h260m-260 50h260m-260 50h260" stroke="#bdc8bb"/>'
            '<text x="388" y="270" font-size="18" fill="#9c4a33">MC1 / Q1(a)</text></g></svg>').encode()


class LocalService(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self):
        super().__init__(("127.0.0.1", 0), Handler)
        self.base = f"http://127.0.0.1:{self.server_address[1]}"
        self.tokens, self.records, self.calls, self.failures, self.denied = {}, {}, [], {}, []
        self.lock = threading.Lock()

    def token(self, account):
        token = ("synthetic_" + account + "_" + os.urandom(20).hex())[:64]
        self.tokens[token] = account
        return token

    def fail(self, token, path, status=503, error="service_unavailable", method="*"):
        self.failures[(token, method, path)] = (status, error)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def send(self, body, mime="application/json", status=200):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; object-src 'none'; base-uri 'self'")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def identify(self):
        token = self.headers.get("Authorization", "").removeprefix("Bearer ")
        return token, self.server.tokens.get(token)

    def record_request(self):
        path = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
        token, account = self.identify()
        with self.server.lock:
            self.server.calls.append({"method": self.command, "path": path, "token": token, "account": account})
        return path, token, account

    def payload(self):
        return json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))) or b"{}")

    def reject_api(self, path, token, account):
        failure = self.server.failures.get((token, self.command, path)) or self.server.failures.get((token, "*", path))
        if failure:
            self.send({"error": failure[1]}, status=failure[0])
            return True
        if not account:
            self.send({"error": "invalid_session"}, status=401)
            return True
        return False

    def do_GET(self):
        path, token, account = self.record_request()
        if path.startswith("/api/"):
            if self.reject_api(path, token, account):
                return
            if path == "/api/bank":
                return self.send(fixture_bank(account))
            if path == "/api/sync":
                saved = self.server.records.get(account)
                return self.send({"data": saved, "sha": "synthetic-version" if saved else None})
            if path == "/api/papers/catalog":
                return self.send(fixture_catalog(account))
            if path == "/api/ai/status":
                return self.send({"configured": False, "practiceEnabled": False, "modes": ["review", "followup"]})
            if re.fullmatch(r"/api/papers/(chem|bio|math|m2|physics)/2022/manifest", path):
                return self.send(MANIFEST)
            if re.fullmatch(r"/api/papers/(chem|bio|math|m2|physics)/2022/pages/(?:[A-Za-z0-9_-]+/)?[1-3]", path):
                return self.send(synthetic_page(int(path[-1])), "image/svg+xml")
            if path.startswith("/api/bank/images/"):
                return self.send(synthetic_page(), "image/svg+xml")
            return self.send({"error": "synthetic_endpoint_not_found"}, status=404)
        # Never read original personal/question images; provide neutral generated artwork.
        if path.startswith("/images/"):
            return self.send(synthetic_page(), "image/svg+xml")
        relative = path.lstrip("/") or "index.html"
        if relative == "demo/":
            relative = "demo/index.html"
        # Deny all subdirectories except direct demo public source; resolve before reading.
        allowed = re.fullmatch(r"[A-Za-z0-9_.-]+\.(?:html|js|css)", relative) or relative in {
            "notebook-mark.svg", "demo/index.html", "demo/demo-data.js", "demo/demo-adapter.js"}
        file = (ROOT / relative).resolve()
        if not allowed or not file.is_relative_to(ROOT) or file.parent not in (ROOT, ROOT / "demo") or not file.is_file() or file.is_symlink():
            self.server.denied.append(path)
            return self.send({"error": "public_source_allowlist_only"}, status=404)
        body = file.read_bytes()
        if file.name == "index.html" and file.parent == ROOT:
            source = body.decode()
            source = re.sub(r'window\.QUIZ_SYNC_API\s*=\s*([\"\']).*?\1', 'window.QUIZ_SYNC_API=' + json.dumps(self.server.base + "/api"), source)
            source = source.replace("https://snowy-cake-a0a7.3355718646.workers.dev", self.server.base + "/api")
            body = source.encode()
        return self.send(body, mimetypes.guess_type(file.name)[0] or "application/octet-stream")

    def do_POST(self):
        path, token, account = self.record_request()
        body = self.payload()
        if path == "/api/auth/password":
            account = str(body.get("username", "")).lower()
            if account not in ACCOUNTS or body.get("password") != PASSWORD:
                return self.send({"error": "invalid_password"}, status=401)
            return self.send({"sessionId": self.server.token(account), "userId": account})
        if self.reject_api(path, token, account):
            return
        if path == "/api/auth/logout":
            return self.send({"ok": True})
        return self.send({"error": "ai_practice_disabled"}, status=410)

    def do_PUT(self):
        path, token, account = self.record_request()
        body = self.payload()
        if self.reject_api(path, token, account):
            return
        if path == "/api/sync":
            self.server.records[account] = copy.deepcopy(body.get("data"))
            with self.server.lock:
                self.server.calls[-1]["data"] = copy.deepcopy(body.get("data"))
            return self.send({"sha": "synthetic-version", "savedAt": "2026-11-11T12:00:00Z"})
        return self.send({"error": "synthetic_endpoint_not_found"}, status=404)


class WebSocket:
    """Minimal local RFC6455 transport; masks client frames and handles ping/fragmentation."""
    def __init__(self, url):
        parsed = urllib.parse.urlparse(url)
        assert parsed.scheme == "ws" and parsed.hostname == "127.0.0.1", "CDP must be loopback"
        self.socket = socket.create_connection((parsed.hostname, parsed.port), timeout=15)
        self.buffer = b""
        key = base64.b64encode(os.urandom(16)).decode()
        path = parsed.path + ("?" + parsed.query if parsed.query else "")
        self.socket.sendall((f"GET {path} HTTP/1.1\r\nHost: {parsed.netloc}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        while b"\r\n\r\n" not in self.buffer:
            self.buffer += self.socket.recv(4096)
        header, self.buffer = self.buffer.split(b"\r\n\r\n", 1)
        expected = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest())
        assert header.startswith(b"HTTP/1.1 101") and expected.lower() in header.lower(), header.decode(errors="replace")

    def exact(self, count):
        while len(self.buffer) < count:
            chunk = self.socket.recv(max(4096, count - len(self.buffer)))
            if not chunk:
                raise EOFError("Chrome DevTools socket closed")
            self.buffer += chunk
        out, self.buffer = self.buffer[:count], self.buffer[count:]
        return out

    def send(self, payload, opcode=1):
        payload = payload.encode() if isinstance(payload, str) else payload
        length = len(payload)
        header = bytes([0x80 | opcode, 0x80 | (length if length < 126 else 126 if length < 65536 else 127)])
        if length >= 126:
            header += struct.pack("!H" if length < 65536 else "!Q", length)
        mask = os.urandom(4)
        self.socket.sendall(header + mask + bytes(value ^ mask[index % 4] for index, value in enumerate(payload)))

    def receive(self):
        parts = []
        while True:
            first, second = self.exact(2)
            length, opcode = second & 127, first & 15
            if length in (126, 127):
                length = struct.unpack("!H" if length == 126 else "!Q", self.exact(2 if length == 126 else 8))[0]
            mask = self.exact(4) if second & 128 else None
            payload = self.exact(length)
            if mask:
                payload = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
            if opcode == 8:
                raise EOFError("Chrome DevTools sent close frame")
            if opcode == 9:
                self.send(payload, 10)
                continue
            if opcode == 10:
                continue
            parts.append(payload)
            if first & 0x80:
                return b"".join(parts).decode()

    def close(self):
        self.socket.close()


class CDP:
    def __init__(self, url, base=None):
        self.ws = WebSocket(url)
        self.serial, self.pending, self.errors, self.blocked, self.requests = 0, {}, [], [], []
        self.base, self.loads = base, 0

    def send(self, method, params=None):
        self.serial += 1
        self.ws.send(json.dumps({"id": self.serial, "method": method, "params": params or {}}))
        return self.serial

    def call(self, method, params=None):
        ident = self.send(method, params)
        while ident not in self.pending:
            message = json.loads(self.ws.receive())
            if "id" in message:
                self.pending[message["id"]] = message
            else:
                self.event(message.get("method"), message.get("params", {}))
        response = self.pending.pop(ident)
        if "error" in response:
            raise RuntimeError(f"{method}: {response['error']}")
        return response.get("result", {})

    def event(self, method, params):
        if method == "Fetch.requestPaused":
            url = params["request"]["url"]
            permitted = url.startswith((self.base + "/", "data:", "blob:")) if self.base else True
            if not permitted:
                self.blocked.append(url)
            self.send("Fetch.continueRequest" if permitted else "Fetch.failRequest", {"requestId": params["requestId"], **({} if permitted else {"errorReason": "BlockedByClient"})})
        elif method == "Runtime.exceptionThrown":
            detail = params["exceptionDetails"]
            self.errors.append(detail.get("exception", {}).get("description", detail.get("text")))
        elif method == "Page.loadEventFired":
            self.loads += 1
        elif method == "Network.requestWillBeSent":
            self.requests.append(params["request"]["url"])
        elif method == "Page.javascriptDialogOpening":
            self.send("Page.handleJavaScriptDialog", {"accept": False})

    def evaluate(self, expression):
        response = self.call("Runtime.evaluate", {"expression": expression, "returnByValue": True, "awaitPromise": True, "userGesture": True})
        if "exceptionDetails" in response:
            detail = response["exceptionDetails"]
            raise RuntimeError(detail.get("exception", {}).get("description", detail.get("text", "JavaScript evaluation failed")))
        return response.get("result", {}).get("value")

    def wait(self, expression, timeout=12, description=None):
        deadline, last = time.monotonic() + timeout, None
        while time.monotonic() < deadline:
            try:
                last = self.evaluate(expression)
                if last:
                    return last
            except RuntimeError as error:
                last = str(error)
            time.sleep(.04)
        raise AssertionError(f"Timed out: {description or expression}; last={last!r}")

    def exists(self, selector):
        return self.evaluate(f"!!document.querySelector({json.dumps(selector)})")

    def visible(self, selector):
        return self.evaluate(f"(() => {{ const e=document.querySelector({json.dumps(selector)}); return !!e && e.checkVisibility(); }})()")

    def selector(self, selector):
        return self.wait(f"document.querySelector({json.dumps(selector)})?.checkVisibility()", description=selector)

    def click(self, selector):
        self.selector(selector)
        # Do not scroll an already clickable sticky toolbar: real pointer input does not.
        self.evaluate(f"(() => {{ const e=document.querySelector({json.dumps(selector)}),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y); if(!(x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&(h===e||e.contains(h))))e.scrollIntoView({{block:'center',inline:'nearest',behavior:'instant'}}); }})()")
        box = self.wait(f"(() => {{ const e=document.querySelector({json.dumps(selector)}), r=e.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; const hit=document.elementFromPoint(x,y); return !e.disabled && r.width>0 && r.height>0 && x>=0 && x<innerWidth && y>=0 && y<innerHeight && (hit===e || e.contains(hit)) && {{x,y}}; }})()", description="clickable " + selector)
        self.call("Input.dispatchMouseEvent", {"type": "mouseMoved", **box})
        self.call("Input.dispatchMouseEvent", {"type": "mousePressed", "button": "left", "clickCount": 1, **box})
        self.call("Input.dispatchMouseEvent", {"type": "mouseReleased", "button": "left", "clickCount": 1, **box})

    def fill(self, selector, value):
        self.click(selector)
        self.evaluate(f"document.querySelector({json.dumps(selector)}).select()")
        self.call("Input.insertText", {"text": value})

    def select(self, selector, value):
        self.selector(selector)
        return self.evaluate(f"(() => {{ const e=document.querySelector({json.dumps(selector)}); e.value={json.dumps(value)}; e.dispatchEvent(new Event('change',{{bubbles:true}})); return e.value; }})()")

    def key(self, key, code):
        for event in ("keyDown", "keyUp"):
            self.call("Input.dispatchKeyEvent", {"type": event, "key": key, "code": key, "windowsVirtualKeyCode": code, "nativeVirtualKeyCode": code})

    def screenshot(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        image = self.call("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False, "fromSurface": True})
        path.write_bytes(base64.b64decode(image["data"]))


class Browser:
    def __init__(self, executable):
        self.profile = tempfile.TemporaryDirectory(prefix="redesign-chrome-")
        self.process = subprocess.Popen([executable, "--headless=new", "--remote-debugging-port=0",
            "--remote-debugging-address=127.0.0.1", f"--user-data-dir={self.profile.name}", "--no-first-run",
            "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--disable-sync",
            "--disable-default-apps", "--disable-extensions", "--metrics-recording-only", "--no-proxy-server",
            # Nested macOS sandboxing is unavailable in the harness. Only trusted,
            # generated loopback fixtures are loaded; harness file policy stays active.
            "--no-sandbox", "--disable-gpu-sandbox", "--disable-breakpad", "--disable-crash-reporter",
            "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost", "about:blank"],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        lines = queue.Queue()
        self.log = []
        def consume():
            for line in self.process.stderr:
                self.log.append(line.strip())
                lines.put(line.strip())
        threading.Thread(target=consume, daemon=True).start()
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            try:
                line = lines.get(timeout=1)
            except queue.Empty:
                if self.process.poll() is not None:
                    raise RuntimeError("Headless browser exited before opening DevTools")
                continue
            if "DevTools listening on " in line:
                endpoint = line.split("DevTools listening on ", 1)[1]
                self.http = "http://" + urllib.parse.urlparse(endpoint).netloc
                self.root = CDP(endpoint)
                self.version = self.root.call("Browser.getVersion")
                return
        self.close()
        raise RuntimeError("No Chrome DevTools endpoint within 25 seconds")

    def context(self, base):
        ident = self.root.call("Target.createBrowserContext", {"disposeOnDetach": True})["browserContextId"]
        target = self.root.call("Target.createTarget", {"url": "about:blank", "browserContextId": ident})["targetId"]
        page = CDP(self.http.replace("http://", "ws://") + "/devtools/page/" + target, base)
        for method in ("Page.enable", "Runtime.enable", "Network.enable"):
            page.call(method)
        page.call("Fetch.enable", {"patterns": [{"urlPattern": "*"}]})
        return ident, page

    def close(self):
        if hasattr(self, "root"):
            try:
                self.root.send("Browser.close")
                self.root.ws.close()
            except (OSError, EOFError):
                pass
        if hasattr(self, "process"):
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.terminate()
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=5)
        # This is exclusively the newly-created, checked temporary browser profile.
        if hasattr(self, "profile"):
            assert pathlib.Path(self.profile.name).resolve().name.startswith("redesign-chrome-")
            self.profile.cleanup()


class Journey:
    def __init__(self, browser, service, name, artifacts, screenshots=False, account="kyle", authenticated=True, viewport=(1440, 1000), demo=False):
        self.browser, self.service, self.name, self.account = browser, service, name, account
        self.prefix = "dse_demo_" if demo else ""
        self.demo = demo
        self.artifacts, self.screenshots, self.evidence = artifacts, screenshots, []
        self.context, self.page = browser.context(service.base)
        self.token = service.token(account)
        self.viewport(*viewport)
        self.page.call("Emulation.setEmulatedMedia", {"features": [{"name": "prefers-reduced-motion", "value": "reduce"}]})
        seed = {self.prefix + "dse_quiz_user_v1": account}
        self.production_seed = {}
        if demo:
            # Deliberately different synthetic production state proves prefix isolation.
            self.production_seed = {"dse_quiz_user_v1": "yeelam",
                "dse_quiz_sync_session_v1": "synthetic_production_0123456789abcdef0123456789abcdef",
                "dse_quiz_sessions_v2": '[{"synthetic_production_sentinel":true}]',
                "dse_quiz_draft_v2": '{"synthetic_production_sentinel":{"text":"DO_NOT_TOUCH"}}'}
            seed.update(self.production_seed)
        elif authenticated:
            seed.update({"dse_quiz_sync_session_v1": self.token, "dse_quiz_auth_mode_v1": "password"})
        self.page.call("Page.addScriptToEvaluateOnNewDocument", {"source": "(() => {if(localStorage.getItem('__redesign_seeded')) return;localStorage.setItem('__redesign_seeded','1');const seed=" + json.dumps(seed) + ";Object.keys(seed).forEach(k=>localStorage.setItem(k,seed[k]));})()"})
        previous = self.page.loads
        self.page.call("Page.navigate", {"url": service.base + ("/demo/" if demo else "/") + "#/"})
        self.page.wait("document.readyState==='complete' && !!document.querySelector('#app')")
        assert self.page.loads > previous
        self.page.wait("!!window.DSEStudy && !!window.DSELibrary")
        if authenticated:
            self.home()
        else:
            self.page.selector("#passwordLoginForm")

    def viewport(self, width, height):
        self.width, self.height = width, height
        self.page.call("Emulation.setDeviceMetricsOverride", {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": width <= 600})
        self.page.call("Emulation.setTouchEmulationEnabled", {"enabled": width <= 1024, "maxTouchPoints": 1})

    def route(self, route, ready=None):
        self.page.evaluate("location.hash=" + json.dumps(route))
        self.page.wait("location.hash===" + json.dumps(route))
        self.page.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))")
        if ready:
            self.page.wait("!!document.querySelector(" + json.dumps(ready) + ")", description="route ready " + ready)
        return self.page

    def home(self):
        self.route("#/", "#todayStart")
        return self.page

    def reload(self, ready):
        # Clear an ephemeral document marker, then wait for the replacement document.
        self.page.evaluate("window.__redesign_old_document=true")
        self.page.call("Page.reload", {"ignoreCache": True})
        self.page.wait("!window.__redesign_old_document && document.readyState==='complete'")
        self.page.selector(ready)

    def storage(self, key, account=None, default=None):
        account = account or self.account
        key = self.prefix + key + (":" + account if account != "kyle" else "")
        return self.page.evaluate("JSON.parse(localStorage.getItem(" + json.dumps(key) + ")||" + json.dumps(json.dumps(default)) + ")")

    def sessions(self, account=None):
        return self.storage("dse_quiz_sessions_v2", account, [])

    def snap(self, label):
        if self.screenshots:
            path = self.artifacts / f"{self.name}-{self.width}x{self.height}-{label}.png"
            self.page.screenshot(path)
            self.evidence.append(str(path))

    def save(self):
        self.page.click("#saveSessionBtn")
        self.page.wait("!document.querySelector('#saveSessionBtn') && !document.querySelector('#resultPanel').hidden")

    def login(self, account, password=PASSWORD):
        if self.page.evaluate("document.querySelector('#syncUsername').tagName==='SELECT'"):
            value = self.page.evaluate("Array.from(document.querySelector('#syncUsername').options).find(o=>o.value.toLowerCase()===" + json.dumps(account) + ").value")
            self.page.select("#syncUsername", value)
        else:
            self.page.fill("#syncUsername", account)
        self.page.fill("#syncPassword", password)
        self.page.click("#passwordLoginBtn")
        if password == PASSWORD:
            self.page.wait("localStorage.getItem(" + json.dumps(self.prefix + "dse_quiz_user_v1") + ")===" + json.dumps(account) + " && !!localStorage.getItem(" + json.dumps(self.prefix + "dse_quiz_sync_session_v1") + ")")
            self.account = account
            self.token = self.page.evaluate("localStorage.getItem(" + json.dumps(self.prefix + "dse_quiz_sync_session_v1") + ")")
            self.page.wait("!!document.querySelector('#syncDisconnectBtn') || !!document.querySelector('#todayStart')")
        else:
            self.page.wait("document.querySelector('#syncStatus')?.textContent.includes('密碼不正確')")

    def logout(self):
        self.route("#/records", "#syncDisconnectBtn")
        self.page.click("#syncDisconnectBtn")
        self.page.selector("#passwordLoginForm")
        assert self.page.evaluate("localStorage.getItem(" + json.dumps(self.prefix + "dse_quiz_sync_session_v1") + ")===null")

    def healthy(self):
        self.page.evaluate("true")  # Drain pending exception/network notifications.
        assert not self.page.errors, "Unhandled JavaScript errors: " + repr(self.page.errors)
        assert not self.page.blocked, "External network attempts blocked: " + repr(self.page.blocked)
        assert not self.service.denied, "Disallowed public paths requested (not read): " + repr(self.service.denied)
        bad = [url for url in self.page.requests if not url.startswith((self.service.base + "/", "blob:", "data:"))]
        assert not bad, "Unexpected nonlocal request: " + repr(bad)

    def close(self):
        self.page.ws.close()
        self.browser.root.call("Target.disposeBrowserContext", {"browserContextId": self.context})


def drill(code, *ids, back="#/"):
    return "#/drill/" + code + "?ids=" + urllib.parse.quote(",".join(ids), safe="") + "&back=" + urllib.parse.quote(back, safe="")


def choose(journey, item, letter="A"):
    # The redesigned full answer rows delegate to the retained hidden .opt state.
    row = f'#qPaper [data-id="{item}"] [data-option-letter="{letter}"]'
    button = f'#qPaper [data-id="{item}"] [data-l="{letter}"]'
    journey.page.click(row if journey.page.visible(row) else button)
    journey.page.wait(f'document.querySelector({json.dumps(button)}).getAttribute("aria-pressed")==="true"')


def submitted_stage(journey):
    """Review is a separate readable stage; submitted answers remain read-only."""
    p = journey.page
    p.selector("#reviewAnswersBtn")
    assert not p.visible("#qPaper"), "Submitted questions obscure the review stage"
    assert p.evaluate("Array.from(document.querySelectorAll('#qPaper input,#qPaper textarea,#qPaper button')).every(c=>c.disabled)"), "Submitted controls remain editable"
    p.click("#reviewAnswersBtn")
    p.selector("#qPaper")
    assert p.evaluate("document.querySelector('#reviewAnswersBtn').getAttribute('aria-expanded')==='true'")
    p.click("#reviewAnswersBtn")
    p.wait("!document.querySelector('#qPaper').checkVisibility()")
    assert p.evaluate("document.querySelector('#reviewAnswersBtn').getAttribute('aria-expanded')==='false'")


def suite_routes(j):
    routes = [("home", "#/", "#todayStart"), ("practice", "#/practice/chem", "#practiceTopicInfo"),
              ("subjects", "#/library/books", '#app a[href="#/library/books/chem"]'),
              ("library", "#/library/books/chem/T1", "#mlSearch"),
              ("details", "#/library/books/question/chem/chem-2022-mc-1", "#app details[open]"),
              ("concept", "#/library/books/concepts/chem/T1", "#app details"),
              ("session", drill("chem", "chem-2022-mc-2", "chem-2022-q-1"), "#qPaper"),
              ("records", "#/records", "#exportDataBtn"),
              ("paper-subjects", "#/library/papers", '#app a[href="#/library/papers/chem"]'),
              ("paper-years", "#/library/papers/chem", "#paperYears"),
              ("paper", "#/library/papers/chem/2022", "#paperPageSelect")]
    checked, issues = [], []
    for width, height in [(1440, 1000), (1024, 768), (768, 1024), (390, 844), (320, 740)]:
        j.viewport(width, height)
        for label, route, ready in routes:
            j.route(route, ready)
            j.page.evaluate("document.fonts.ready.then(()=>true)")
            overflow = j.page.evaluate("(() => {const p=document.querySelector('#contentScroll');return {document:document.documentElement.scrollWidth-innerWidth,pane:p.scrollWidth-p.clientWidth,main:document.querySelector('#app').scrollWidth-document.querySelector('#app').clientWidth};})()")
            if max(overflow.values()) > 2:
                issues.append(f"{width}x{height} {route}: horizontal overflow {overflow}")
            assert j.page.evaluate("document.querySelector('#app').innerText.trim().length>10"), "Route rendered blank"
            if label == "paper":
                j.page.wait("Array.from(document.querySelectorAll('#paperReader img')).some(img=>img.complete && img.naturalWidth>0)")
                reader_width = j.page.evaluate("document.querySelector('#paperReader').clientWidth")
                if reader_width < min(500, width - 64):
                    issues.append(f"{width}x{height} paper content shrunk to {reader_width}px")
            j.snap(label)
            checked.append(f"{width}x{height}:{label}")
    j.healthy()
    assert not issues, json.dumps(issues, ensure_ascii=False)
    return {"responsive_routes": checked, "viewport_count": 5, "route_count": len(routes)}


def suite_mc(j):
    first, second = "chem-2022-mc-1", "chem-2022-mc-2"
    j.route(drill("chem", first, second), "#qPaper")
    assert j.page.evaluate("document.querySelectorAll('#qPaper article').length") == 2
    choose(j, first)
    j.page.click("#submitAnsweredBtn")
    j.page.selector("#saveSessionBtn")
    assert j.page.evaluate("document.activeElement===document.querySelector('#resultPanel') && document.activeElement.getAttribute('role')==='region'"), "Submit did not move keyboard focus to the result region"
    assert not j.sessions(), "Submission was saved before explicit confirmation"
    submitted_stage(j)
    j.snap("partial-result")
    j.save()
    assert j.page.evaluate("document.activeElement===document.querySelector('#resultPanel')"), "Save did not focus the saved result region"
    saved = j.sessions()
    assert len(saved) == 1 and set(saved[0]["results"]) == {first}, "Unanswered MC entered a partial result"
    assert saved[0]["results"][first]["attempt"]["answer"] == "A"
    j.home()
    j.page.selector("#resumeStudy")
    j.page.click("#resumeStudy")
    j.page.selector("#qPaper")
    assert j.page.evaluate("Array.from(document.querySelectorAll('#qPaper article')).map(n=>n.dataset.id)") == [second]
    choose(j, second, "B")
    j.page.click("#submitBtn")
    j.page.selector("#saveSessionBtn")
    j.save()
    saved = j.sessions()
    assert len(saved) == 2 and saved[-1]["results"][second]["marks"] == 0
    assert saved[-1]["results"][second]["attempt"]["answer"] == "B"
    return {"partial_only_answered": True, "remaining_resume": True, "automatic_mc_correct_and_incorrect": True, "submitted_and_saved_focus": True, "saved_attempts": 2}


def suite_subjective(j):
    item = "chem-2022-q-1"
    j.route(drill("chem", item), "#qPaper textarea[data-step='0']")
    j.page.fill('#qPaper textarea[data-step="0"]', "SYNTHETIC 必要條件已成立")
    j.page.fill('#qPaper textarea[data-step="1"]', "SYNTHETIC 原因已完整解釋")
    j.page.click("#submitBtn")
    j.page.selector("#saveSessionBtn")
    assert not j.sessions(), "Unconfirmed subjective assessment became a session"
    assert j.storage("dse_quiz_pending_review_v1", default={})["ids"] == [item]
    # Refresh during self-marking must restore the exact submitted snapshot.
    j.reload("#saveSessionBtn")
    submitted_stage(j)
    summary = "#resultPanel details:has(input[data-i='0']) > summary"
    if not j.page.visible('#resultPanel input[data-i="0"]'):
        j.page.click(summary)
    j.page.click('#resultPanel input[data-i="0"]')
    j.page.click('#resultPanel input[data-i="1"]')
    j.snap("self-assessment")
    j.save()
    result = j.sessions()[-1]["results"][item]
    assert result["marks"] == 2 and result["checkedIndices"] == [0, 1]
    assert "SYNTHETIC 原因已完整解釋" in result["attempt"]["answer"]
    assert j.storage("dse_quiz_pending_review_v1") is None
    return {"subjective_snapshot": True, "pending_review_refresh": True, "rubric_marks": 2}


def suite_draft(j):
    mc, sub = "chem-2022-mc-1", "chem-2022-q-1"
    j.route(drill("chem", mc, sub), '#qPaper textarea[data-step="0"]')
    choose(j, mc)
    marker = "SYNTHETIC_DRAFT_REFRESH_RESUME"
    j.page.fill('#qPaper textarea[data-step="0"]', marker)
    j.reload('#qPaper textarea[data-step="0"]')
    assert j.page.evaluate('document.querySelector(\'#qPaper textarea[data-step="0"]\').value') == marker
    assert j.page.evaluate('document.querySelector(\'#qPaper [data-l="A"]\').getAttribute("aria-pressed")') == "true"
    assert not j.sessions(), "Draft created a phantom attempt"
    j.home()
    j.page.click("#resumeStudy")
    j.page.selector('#qPaper textarea[data-step="0"]')
    assert j.page.evaluate('document.querySelector(\'#qPaper textarea[data-step="0"]\').value') == marker
    j.snap("resumed-draft")
    return {"mc_refresh": True, "subjective_refresh": True, "home_resume": True, "no_phantom_attempt": True}


def suite_paper(j):
    j.route("#/library/papers/chem/2022", "#paperNextMistake:not([disabled])")
    j.page.click("#paperNextMistake")
    j.page.wait("document.querySelector('#paperPageSelect').value==='2'")
    j.snap("mistake-page")
    if not j.page.visible("#paperRedo"):
        j.page.click("#paperReviewPanel details > summary")
    j.page.click("#paperRedo")
    j.page.selector("#qPaper")
    assert j.page.evaluate("document.querySelectorAll('#qPaper article').length") == 1
    choose(j, "chem-2022-mc-1")
    j.page.click("#submitBtn")
    j.page.selector("#saveSessionBtn")
    j.save()
    j.page.click('#resultPanel a[href*="/library/papers/chem/2022"]')
    j.page.selector("#paperPageSelect")
    j.page.wait("document.querySelector('#paperPageSelect').value==='2'")
    # The functional reader toolbar may be collapsed at compact sizes.
    if not j.page.visible("#paperOpen") and not j.page.visible("#paperZoom"):
        j.page.click("#paperToolsToggle")
    zoom = "#paperOpen" if j.page.exists("#paperOpen") else "#paperZoom"
    j.page.click(zoom)
    j.page.selector("dialog[open] img")
    original = j.page.evaluate("document.querySelector('dialog[open] img').getBoundingClientRect().width")
    j.page.click('dialog[open] button[aria-label="放大本頁"]')
    enlarged = j.page.evaluate("document.querySelector('dialog[open] img').getBoundingClientRect().width")
    assert enlarged > original, "Reader zoom did not enlarge the actual page"
    j.page.key("Escape", 27)
    j.page.wait("!document.querySelector('dialog[open]')")
    j.page.select("#paperPageSelect", "3")
    j.page.wait("document.querySelector('#paperPageSelect').value==='3'")
    j.route("#/records", "#exportDataBtn")
    j.route("#/library/papers/chem/2022", "#paperPageSelect")
    j.page.wait("document.querySelector('#paperPageSelect').value==='3'")
    j.reload("#paperPageSelect")
    j.page.wait("document.querySelector('#paperPageSelect').value==='3'")
    return {"synthetic_pages": 3, "mistake_navigation": True, "single_question_roundtrip": True, "zoom": True, "page_position_refresh": 3}


def suite_auth(j):
    j.snap("login")
    j.login("kyle", "synthetic-wrong-password")
    assert j.page.evaluate("localStorage.getItem('dse_quiz_sync_session_v1')===null")
    assert j.page.evaluate("!document.querySelector('#passwordLoginBtn').disabled")
    j.login("kyle")
    j.home()
    j.route(drill("chem", "chem-2022-mc-1"), "#qPaper")
    choose(j, "chem-2022-mc-1")
    before = j.storage("dse_quiz_draft_v2", default={})
    j.service.fail(j.token, "/api/sync", status=401, error="invalid_session")
    j.route("#/records", "#syncNowBtn")
    j.page.click("#syncNowBtn")
    j.page.selector("#passwordLoginForm")
    assert j.page.evaluate("localStorage.getItem('dse_quiz_sync_session_v1')===null")
    assert j.storage("dse_quiz_draft_v2", default={}) == before, "Expired auth erased a local draft"
    j.snap("expired-session")
    return {"wrong_password": True, "synthetic_login": True, "expired_session": True, "local_draft_retained": True}


def suite_sync(j):
    j.route(drill("chem", "chem-2022-q-1"), '#qPaper textarea[data-step="0"]')
    j.page.fill('#qPaper textarea[data-step="0"]', "SYNTHETIC_OFFLINE_PRESERVED")
    before = j.storage("dse_quiz_draft_v2", default={})
    j.service.fail(j.token, "/api/sync")
    j.route("#/records", "#syncNowBtn")
    j.page.click("#syncNowBtn")
    j.page.wait("document.querySelector('#syncStatus')?.textContent.includes('本機記錄已保留')", timeout=18)
    assert j.storage("dse_quiz_draft_v2", default={}) == before, "503 sync failure modified local draft"
    assert j.page.evaluate("!!localStorage.getItem('dse_quiz_sync_session_v1')"), "Transient sync failure logged the user out"
    j.snap("sync-failure")
    del j.service.failures[(j.token, "*", "/api/sync")]
    j.page.click("#syncNowBtn")
    j.page.wait("/已上傳|雲端已核對|已更新本機/.test(document.querySelector('#syncStatus')?.textContent||'')")
    assert "SYNTHETIC_OFFLINE_PRESERVED" in json.dumps(j.service.records["kyle"], ensure_ascii=False)
    return {"synthetic_503": True, "draft_preserved": True, "auth_retained": True, "manual_retry_uploaded": True}


def normalized_drafts(value):
    """Sync may materialize empty maps; preserve content rather than map omission."""
    value = copy.deepcopy(value)
    for draft in value.values():
        for key in ("pick", "text", "paper", "steps", "changedAt"):
            draft.setdefault(key, {})
        draft.setdefault("deletedAt", 0)
    return value


def suite_accounts(j):
    j.route(drill("chem", "chem-2022-mc-1"), "#qPaper")
    choose(j, "chem-2022-mc-1")
    j.page.click("#submitBtn")
    j.page.selector("#saveSessionBtn")
    j.save()
    j.route(drill("chem", "chem-2022-q-1"), '#qPaper textarea[data-step="0"]')
    marker = "KYLE_SYNTHETIC_ONLY_DRAFT"
    j.page.fill('#qPaper textarea[data-step="0"]', marker)
    kyle_sessions = copy.deepcopy(j.sessions())
    kyle_drafts = copy.deepcopy(j.storage("dse_quiz_draft_v2", default={}))
    j.logout()
    j.login("yeelam")
    j.route("#/library/books", "#app a[href='#/library/books/math']")
    codes = j.page.evaluate("Array.from(document.querySelectorAll('#app a[href]')).map(a=>a.getAttribute('href').match(/^#\\/library\\/books\\/(chem|bio|math|m2|physics)$/)?.[1]).filter(Boolean)")
    assert set(codes) == set(ACCOUNTS["yeelam"]), f"Wrong account subjects: {codes}"
    assert j.sessions() == [] and j.storage("dse_quiz_draft_v2", default={}) == {}, "Kyle state loaded into Yeelam"
    assert j.sessions("kyle") == kyle_sessions and j.storage("dse_quiz_draft_v2", "kyle", {}) == kyle_drafts
    assert marker not in j.page.evaluate("document.querySelector('#app').innerText")
    j.route(drill("math", "math-2022-mc-1"), "#qPaper")
    choose(j, "math-2022-mc-1")
    j.page.click("#submitBtn")
    j.page.selector("#saveSessionBtn")
    j.save()
    assert len(j.sessions()) == 1 and set(j.sessions()[0]["results"]) == {"math-2022-mc-1"}
    j.route("#/records", "#syncNowBtn")
    j.page.click("#syncNowBtn")
    j.page.wait("/已上傳|雲端已核對|已更新本機/.test(document.querySelector('#syncStatus')?.textContent||'')")
    yeelam_remote = json.dumps(j.service.records["yeelam"], ensure_ascii=False)
    assert marker not in yeelam_remote and "chem-2022" not in yeelam_remote, "Cross-account data reached sync payload"
    j.logout()
    j.login("kyle")
    j.home()
    assert j.sessions() == kyle_sessions, "Original account session content changed"
    assert normalized_drafts(j.storage("dse_quiz_draft_v2", default={})) == normalized_drafts(kyle_drafts), "Original account draft content changed"
    j.page.click("#resumeStudy")
    j.page.selector('#qPaper textarea[data-step="0"]')
    assert j.page.evaluate('document.querySelector(\'#qPaper textarea[data-step="0"]\').value') == marker
    j.snap("same-origin-account-isolation")
    return {"same_origin_switches": ["kyle", "yeelam", "kyle"], "account_subjects": sorted(codes), "namespaced_sessions": True, "local_drafts_isolated": True, "sync_payload_isolated": True, "original_account_resumed": True}


def suite_demo(j):
    """Exercise the shipped demo adapter, not the test service's synthetic API."""
    p = j.page
    assert j.demo and p.evaluate("window.QUIZ_DEMO===true")
    assert p.evaluate("document.querySelector('#syncStatus').textContent.includes('模擬同步') && !document.querySelector('#syncStatus').textContent.includes('雲端')"), "Demo labels a local simulated save as real cloud sync"
    assert p.evaluate("Array.from(document.scripts).some(s=>new URL(s.src||location.href).pathname==='/app.js') && !Array.from(document.scripts).some(s=>s.src.includes('/demo/app.js'))"), "Demo does not use the shared root engine"

    def subjects(expected):
        j.route("#/library/books", "#app a[href]")
        actual = p.evaluate("Array.from(document.querySelectorAll('#app a[href]')).map(a=>a.getAttribute('href').match(/^#\\/library\\/books\\/(chem|bio|math|m2|physics)$/)?.[1]).filter(Boolean)")
        assert set(actual) == set(expected), f"Demo account subjects {actual} != {expected}"

    subjects(ACCOUNTS["kyle"])
    j.route(drill("math", "demo-math-1"), "#qPaper")
    choose(j, "demo-math-1")
    p.click("#submitBtn"); p.selector("#saveSessionBtn"); submitted_stage(j); j.save()
    assert j.sessions()[-1]["results"]["demo-math-1"]["marks"] == 1
    j.route(drill("math", "demo-math-5"), '#qPaper textarea[data-step="0"]')
    marker = "KYLE_DEMO_DRAFT_NOT_YEELAM"
    p.fill('#qPaper textarea[data-step="0"]', marker)
    kyle_sessions = copy.deepcopy(j.sessions())
    kyle_drafts = copy.deepcopy(j.storage("dse_quiz_draft_v2", default={}))
    j.logout(); j.login("yeelam")
    subjects(ACCOUNTS["yeelam"])
    assert j.sessions() == [] and j.storage("dse_quiz_draft_v2", default={}) == {}, "Demo accounts share saved answers or drafts"
    j.route("#/library/books/question/chem/demo-chem-1", "#app")
    assert p.evaluate("!document.querySelector('#app .ml-question') && document.querySelector('#app').textContent.includes('未找到這道題')"), "Demo retains the other account's question cache"

    # Verified rubric and unverified/manual self-assessment must remain distinct.
    j.route(drill("math", "demo-math-5"), '#qPaper textarea[data-step="0"]')
    assert p.evaluate("document.querySelector('#qPaper textarea[data-step=\"0\"]').value") == ""
    p.fill('#qPaper textarea[data-step="0"]', "3x = 15")
    p.fill('#qPaper textarea[data-step="1"]', "x = 5")
    p.click("#submitBtn"); p.selector("#saveSessionBtn")
    if not p.visible('#resultPanel input[data-i="0"]'):
        p.click("#resultPanel details:has(input[data-i='0']) > summary")
    p.click('#resultPanel input[data-i="0"]'); p.click('#resultPanel input[data-i="1"]')
    j.snap("verified-rubric"); j.save()
    assert j.sessions()[-1]["results"]["demo-math-5"]["marks"] == 2
    j.route(drill("math", "demo-math-6"), '#qPaper [data-answer-mode="text"]')
    p.click('#qPaper [data-answer-mode="text"]')
    p.fill("#qPaper .ans-box", "合成自評：概念與適用限制，附一個反例。")
    p.click("#submitBtn"); p.selector("#resultPanel .manual-score")
    if not p.visible('#resultPanel input[data-i="0"]'):
        p.click("#resultPanel details:has(input[data-i='0']) > summary")
    p.click('#resultPanel input[data-i="0"]')
    assert p.evaluate("/待核對|待確認/.test(document.querySelector('#allScore').textContent)"), "Unverified rubric was converted into an automatic score"
    before_manual = copy.deepcopy(j.sessions())
    if not p.evaluate("document.querySelector('#saveSessionBtn').disabled"):
        p.click("#saveSessionBtn")
    assert j.sessions() == before_manual and p.exists("#saveSessionBtn"), "Unconfirmed manual score was saved"
    p.fill("#resultPanel .manual-score", "2")
    p.wait("!document.querySelector('#saveSessionBtn').disabled")
    j.snap("manual-self-assessment"); j.save()
    assert j.sessions()[-1]["results"]["demo-math-6"]["marks"] == 2
    j.route(drill("math", "demo-math-2"), "#qPaper")
    choose(j, "demo-math-2", "B")
    p.click("#submitBtn"); p.selector("#saveSessionBtn"); j.save()
    assert j.sessions()[-1]["results"]["demo-math-2"]["marks"] == 1
    assert len(j.sessions()) == 3

    j.viewport(390, 844)
    j.route("#/library/papers/math/2022", "#paperNextMistake:not([disabled])")
    p.wait("document.querySelector('#paperPageSelect').options.length===2")
    p.wait("document.querySelectorAll('#paperReader img').length===2 && Array.from(document.querySelectorAll('#paperReader img')).every(img=>img.complete&&img.naturalWidth>0)")
    p.click("#paperNextMistake")
    p.wait("!!document.querySelector('#paperMistakeSelect').value")
    first_mistake = p.evaluate("document.querySelector('#paperMistakeSelect').value")
    p.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))")
    p.click("#paperNextMistake")
    p.wait("document.querySelector('#paperMistakeSelect').value!==" + json.dumps(first_mistake))
    p.select("#paperPageSelect", "2")
    p.wait("document.querySelector('#paperPageSelect').value==='2'")
    j.snap("synthetic-paper")
    j.reload("#paperPageSelect")
    p.wait("document.querySelector('#paperPageSelect').value==='2'")
    p.wait("Array.from(document.querySelectorAll('#paperReader img')).some(img=>img.complete&&img.naturalWidth>0)")
    j.logout(); j.login("kyle"); j.home()
    assert j.sessions() == kyle_sessions
    assert normalized_drafts(j.storage("dse_quiz_draft_v2", default={})) == normalized_drafts(kyle_drafts)
    p.click("#resumeStudy"); p.selector('#qPaper textarea[data-step="0"]')
    assert p.evaluate("document.querySelector('#qPaper textarea[data-step=\"0\"]').value") == marker

    for width, height in [(1440, 1000), (390, 844)]:
        j.viewport(width, height)
        for label, route, ready in [("home", "#/", "#todayStart"),
                                    ("records", "#/records", "#exportDataBtn"),
                                    ("paper", "#/library/papers/math/2022", "#paperPageSelect")]:
            j.route(route, ready)
            overflow = p.evaluate("Math.max(document.documentElement.scrollWidth-innerWidth,document.querySelector('#contentScroll').scrollWidth-document.querySelector('#contentScroll').clientWidth,document.querySelector('#app').scrollWidth-document.querySelector('#app').clientWidth)")
            assert overflow <= 2, f"Demo {width}x{height} {route}: horizontal overflow {overflow}px"
            if label == "paper":
                p.wait("Array.from(document.querySelectorAll('#paperReader img')).some(img=>img.complete&&img.naturalWidth>0)")
            j.snap(label)
    for key, value in j.production_seed.items():
        assert p.evaluate("localStorage.getItem(" + json.dumps(key) + ")") == value, "Demo modified synthetic unprefixed production state: " + key
    assert p.evaluate("Object.keys(localStorage).every(k=>k.startsWith('dse_demo_')||k==='__redesign_seeded'||" + json.dumps(list(j.production_seed)) + ".includes(k))"), "Demo wrote outside its storage namespace"
    assert not [call for call in j.service.calls if call["path"].startswith(("/api/", "/demo/__demo_api"))], "Demo bypassed its local transport adapter"
    return {"shared_root_engine": True, "both_account_mcs": True, "verified_rubric_marks": 2,
            "manual_score_requires_confirmation": True, "same_origin_account_isolation": True,
            "two_page_paper_and_refresh": True, "production_storage_untouched": True,
            "no_api_network": True, "demo_viewports": ["1440x1000", "390x844"]}


SUITES = {"routes": suite_routes, "mc": suite_mc, "subjective": suite_subjective, "draft": suite_draft,
          "paper": suite_paper, "auth": suite_auth, "sync": suite_sync, "accounts": suite_accounts, "demo": suite_demo}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--suite", default="all", help="all, or comma-separated " + ",".join(SUITES))
    parser.add_argument("--chrome", default=shutil.which("chromium") or shutil.which("google-chrome") or "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    parser.add_argument("--artifacts", type=pathlib.Path, default=pathlib.Path(tempfile.gettempdir()) / "dse-redesign-browser")
    parser.add_argument("--screenshots", action="store_true", help="Save successful viewport screenshots as well as failures")
    args = parser.parse_args()
    suites = list(SUITES) if args.suite == "all" else args.suite.split(",")
    if any(name not in SUITES for name in suites):
        parser.error("Unknown suite")
    if not pathlib.Path(args.chrome).is_file():
        parser.error("No installed Chromium browser at --chrome path")
    server, browser, results = LocalService(), None, []
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        browser = Browser(args.chrome)
        print(json.dumps({"runtime": "stdlib Python + Chrome DevTools Protocol", "browser": browser.version,
                          "source": str(ROOT), "local_service": server.base, "external_network": "blocked", "private_paths": "not served/read"}, ensure_ascii=False), flush=True)
        for name in suites:
            # Clear synthetic cloud state between independent tests, never browser/user records.
            server.records.clear()
            server.calls.clear()
            j, started = None, time.monotonic()
            try:
                j = Journey(browser, server, name, args.artifacts, args.screenshots, authenticated=name != "auth", viewport=(390, 844) if name in ("mc", "draft", "paper", "auth") else (1440, 1000), demo=name == "demo")
                evidence = SUITES[name](j)
                j.healthy()
                result = {"suite": name, "status": "passed", "evidence": evidence, "screenshots": j.evidence}
            except Exception as error:
                screenshot = args.artifacts / f"{name}-failure.png"
                if j:
                    try:
                        j.page.screenshot(screenshot)
                    except Exception:
                        screenshot = None
                else:
                    screenshot = None
                result = {"suite": name, "status": "failed", "error": str(error), "screenshot": str(screenshot) if screenshot else None,
                          "url": j.page.evaluate("location.href") if j else None, "page_errors": j.page.errors if j else [], "traceback": traceback.format_exc(), "last_requests": server.calls[-12:]}
            finally:
                if j:
                    j.close()
            result["elapsed_seconds"] = round(time.monotonic() - started, 2)
            results.append(result)
            print(json.dumps(result, ensure_ascii=False), flush=True)
    finally:
        if browser:
            browser.close()
        server.shutdown()
        server.server_close()
    args.artifacts.mkdir(parents=True, exist_ok=True)
    (args.artifacts / "results.json").write_text(json.dumps({
        "browser": browser.version if browser else None,
        "passed": bool(results) and all(result["status"] == "passed" for result in results),
        "suites": results,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 1 if any(result["status"] == "failed" for result in results) else 0


if __name__ == "__main__":
    raise SystemExit(main())
