"""以合成資料重走學生旅程；所有服務、作答和影像均留在本機。

執行：python -B tests/experience_browser.py --suite all
需要 Playwright Python 與 Chromium。成功時只輸出 JSON，失敗時才截圖。
"""
from __future__ import annotations

import argparse
import copy
import json
import mimetypes
import pathlib
import shutil
import tempfile
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright


ROOT = pathlib.Path(__file__).resolve().parents[1]
ACCOUNT_SUBJECTS = {"kyle": ["chem", "bio", "math"], "yeelam": ["math", "m2", "physics"]}
SUBJECT_NAMES = {"chem": "化學", "bio": "生物", "math": "數學", "m2": "數學延伸2", "physics": "物理"}


def fixture_item(code, number, kind="mc", topic="T1"):
    item = {
        "id": f"{code}-2022-{'mc' if kind == 'mc' else 'q'}-{number}",
        "kind": kind, "topic": topic, "year": "2022", "paper": "卷一",
        "qref": f"MC{number}" if kind == "mc" else f"Q{number}(a)",
        "stem": f"合成物質{'甲' if number == 1 else '乙'}的必要條件",
        "stemFull": f"這是用於功能測試的合成題目 {number}。請判斷必要條件並寫下答案；不含真實試卷資料。",
        "marks": 1 if kind == "mc" else 2, "lost": 1 if kind == "mc" else 2,
        "correctOpt": "A" if kind == "mc" else "", "correct": "合成參考：必要條件成立。",
        "option": "B" if kind == "mc" else "", "deduct": "合成錯因：漏寫必要條件。",
        "my": [["合成原卷答案", True]], "points": "先指出必要條件，再完整解釋原因。",
        "checks": ["指出必要條件", "解釋原因"],
    }
    if kind == "mc":
        item["options"] = ["必要條件成立", "缺少必要條件", "無關條件", "資料不足"]
        if number == 1:
            item["figures"] = [{"path": f"images/{code}-2022-fig-synthetic.jpg", "alt": "合成題目圖", "width": 600, "height": 840}]
    else:
        item["answerFields"] = ["必要條件", "原因"]
        item["practiceRubric"] = {"version": 1, "groups": [
            {"id": "condition", "marks": 1, "all": [0]},
            {"id": "reason", "marks": 1, "all": [1]},
        ]}
    return item


def fixture_bank(account="kyle", empty=False):
    subjects = {}
    for code in ACCOUNT_SUBJECTS[account]:
        items = [] if empty else [fixture_item(code, 1), fixture_item(code, 2),
                                 fixture_item(code, 1, "sub"), fixture_item(code, 2, "sub", "T2")]
        subjects[code] = {"name": SUBJECT_NAMES[code], "topics": [] if empty else [
            {"code": "T1", "name": "合成條件與概念"}, {"code": "T2", "name": "合成進階概念"}], "items": items}
    return {"subjects": subjects}


def fixture_catalog(account="kyle", empty=False):
    catalog = {"subjects": {}, "papers": {}}
    for code in ACCOUNT_SUBJECTS[account]:
        catalog["subjects"][code] = [] if empty else ["2022"]
        catalog["papers"][code] = {} if empty else {"2022": {
            "title": "2022 合成批改卷", "pages": 3,
            "assessment": {"earned": 7, "total": 10, "scope": "合成卷一", "components": [],
                           "boundaries": [{"level": "4", "minimumPercent": 60},
                                          {"level": "5", "minimumPercent": 80}]}}}
    return catalog


MANIFEST = {"version": "0123456789abcdef", "pages": 3,
            "page_sizes": [[600, 840]] * 3,
            "sections": [{"label": "合成總結", "page": 1}, {"label": "合成卷一", "page": 2}],
            "mistakes": [{"label": "MC1", "question_id": "MC1", "page": 2, "x": .25, "y": .3},
                         {"label": "Q1(a)", "question_id": "Q1", "page": 3, "x": .65, "y": .5}]}


def synthetic_page(number):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="840" viewBox="0 0 600 840">'
            '<rect width="600" height="840" fill="white"/><g font-family="sans-serif" fill="#14243a">'
            f'<text x="35" y="60" font-size="25">SYNTHETIC PAPER / PAGE {number}</text>'
            '<text x="35" y="100" font-size="16">Local browser regression fixture. No examination content.</text>'
            '<rect x="30" y="160" width="330" height="450" fill="#f4f6f8" stroke="#aab"/>'
            '<path d="M50 210h260m-260 45h260m-260 45h260m-260 45h260" stroke="#bcd"/>'
            '<text x="385" y="260" font-size="18" fill="#a33">MC1 / Q1(a)</text>'
            '<text x="385" y="295" font-size="13" fill="#27704c">Checked reference</text>'
            '</g></svg>').encode()


class LocalService(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self):
        super().__init__(("127.0.0.1", 0), Handler)
        self.base = f"http://127.0.0.1:{self.server_address[1]}"
        self.records = {}
        self.calls = []
        self.lock = threading.Lock()


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
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def identity(self):
        token = self.headers.get("Authorization", "").removeprefix("Bearer ")
        return token, "yeelam" if "yeelam" in token else "kyle", "empty" in token

    def call(self):
        path = urllib.parse.urlparse(self.path).path
        with self.server.lock:
            self.server.calls.append({"method": self.command, "path": path, "token": self.identity()[0]})
        return path

    def payload(self):
        return json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))) or b"{}")

    def do_GET(self):
        path = self.call()
        token, account, empty = self.identity()
        if path == "/api/bank":
            return self.send(fixture_bank(account, empty))
        if path == "/api/sync":
            saved = self.server.records.get(token)
            return self.send({"data": saved, "sha": "synthetic-local-version" if saved else None})
        if path == "/api/papers/catalog":
            return self.send(fixture_catalog(account, empty))
        if path == "/api/ai/status":
            return self.send({"configured": False, "practiceEnabled": False, "modes": ["review", "followup"]})
        if path.startswith("/api/papers/"):
            if path.endswith("/manifest"):
                return self.send(MANIFEST)
            if "/pages/" in path:
                return self.send(synthetic_page(int(path.split("/")[-1])), "image/svg+xml")
        if path.startswith("/api/bank/images/"):
            return self.send(synthetic_page(1), "image/svg+xml")
        if path.startswith("/api/"):
            return self.send({"error": "synthetic_endpoint_not_found"}, status=404)
        relative = urllib.parse.unquote(path).lstrip("/") or "index.html"
        file = (ROOT / relative).resolve()
        if not file.is_relative_to(ROOT) or not file.is_file():
            return self.send({"error": "not_found"}, status=404)
        body = file.read_bytes()
        if file.name == "index.html":
            body = body.replace(b"https://snowy-cake-a0a7.3355718646.workers.dev", (self.server.base + "/api").encode())
        return self.send(body, mimetypes.guess_type(file.name)[0] or "application/octet-stream")

    def do_PUT(self):
        path = self.call()
        body = self.payload()
        if path == "/api/sync":
            self.server.records[self.identity()[0]] = copy.deepcopy(body.get("data"))
            return self.send({"sha": "synthetic-local-version"})
        return self.send({"error": "synthetic_endpoint_not_found"}, status=404)

    def do_POST(self):
        path = self.call()
        self.payload()
        if path == "/api/auth/logout":
            return self.send({"ok": True})
        return self.send({"error": "ai_practice_disabled"}, status=410)


class Journey:
    def __init__(self, browser, service, name, viewport=(390, 844), account="kyle", empty=False):
        self.name, self.service, self.account = name, service, account
        self.stage = "開始旅程"
        self.paper_trace = []
        self.token = ("synthetic_" + account + ("_empty" if empty else "") + "_" + str(time.time_ns())).ljust(50, "0")
        self.context = browser.new_context(viewport={"width": viewport[0], "height": viewport[1]},
                                           is_mobile=viewport[0] <= 860, has_touch=viewport[0] <= 860,
                                           device_scale_factor=1, reduced_motion="reduce")
        self.blocked = []

        def local_only(route):
            url = route.request.url
            host = urllib.parse.urlparse(url).hostname
            if host in ("127.0.0.1", None) or url.startswith(("blob:", "data:")):
                return route.continue_()
            self.blocked.append(url)
            route.abort()

        self.context.route("**/*", local_only)
        self.context.add_init_script("""(seed => {
          if (localStorage.getItem('synthetic_journey_seed') === seed.token) return;
          localStorage.setItem('synthetic_journey_seed',seed.token);
          localStorage.setItem('dse_quiz_user_v1',seed.account);
          localStorage.setItem('dse_quiz_sync_session_v1',seed.token);
          localStorage.setItem('dse_quiz_auth_mode_v1','password');
        })(""" + json.dumps({"token": self.token, "account": account}) + ");")
        self.page = self.context.new_page()
        self.page.set_default_timeout(8000)
        self.errors = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))

    def navigate(self, hash_route="/#/"):
        if hash_route.startswith("#"):
            hash_route = "/" + hash_route
        self.page.goto(self.service.base + hash_route, wait_until="domcontentloaded")
        self.page.wait_for_selector("#app")
        return self.page

    def home(self):
        self.navigate("/#/")
        self.page.wait_for_function("document.querySelector('.home-bank-total b')?.textContent !== '—' && document.querySelector('.home-bank-total b') !== null")
        self.page.evaluate("document.fonts.ready")
        return self.page

    def saved_sessions(self):
        key = "dse_quiz_sessions_v2" + (":" + self.account if self.account != "kyle" else "")
        return self.page.evaluate("key => JSON.parse(localStorage.getItem(key)||'[]')", key)

    def save_result(self):
        save = self.page.locator("#saveSessionBtn")
        if save.count():
            save.click()
        self.page.wait_for_selector(".saved-card")

    def select_first_mc(self):
        first = self.page.locator('.sq[data-kind="mc"]').first
        item_id = first.get_attribute("data-id")
        first.locator('.opt[data-l="A"]').click()
        return item_id

    def no_errors(self):
        assert not self.errors, "頁面產生未處理錯誤：" + repr(self.errors)
        assert not self.blocked, "頁面嘗試存取本機外的服務：" + repr(self.blocked)

    def close(self):
        self.context.close()


def mobile(journey):
    page = journey.home()
    primary = page.locator("#homeReviewStart")
    box = primary.bounding_box()
    assert box and box["y"] >= 0 and box["y"] + box["height"] <= 844, "手機首頁的開始入口不在首屏"
    primary.click()
    page.wait_for_selector(".sq")
    kinds = page.locator(".sq").evaluate_all("nodes => nodes.map(node => node.dataset.kind)")
    assert kinds and all(kind == "mc" for kind in kinds), "手機預設短練習包含長答題"
    item_id = journey.select_first_mc()
    figure = page.locator('#qPaper img.q-img').first
    figure.wait_for(state="visible")
    page.wait_for_function("document.querySelector('#qPaper img.q-img').naturalWidth > 0")
    figure.click()
    page.wait_for_selector('dialog.practice-image-zoom[open]')
    image = page.locator('dialog.practice-image-zoom img')
    initial_width = image.bounding_box()["width"]
    page.get_by_role("button", name="放大原題圖片", exact=True).click()
    assert image.bounding_box()["width"] > initial_width, "手機原題圖片沒有實際放大"
    page.get_by_role("button", name="返回這道題", exact=True).click()
    assert not page.locator('dialog.practice-image-zoom').count()
    assert page.locator(f'.sq[data-id="{item_id}"] .opt[data-l="A"]').get_attribute('aria-pressed') == 'true', "放大原圖改變了作答"
    before_submit_calls = [call for call in journey.service.calls if call["token"] == journey.token and call["path"].startswith("/api/ai/")]
    assert not before_submit_calls, "未提交練習時發出了 AI 請求"
    partial = page.locator("#submitAnsweredBtn")
    assert partial.count(), "找不到只提交已作答題目的入口"
    partial.first.click()
    journey.save_result()
    saved = journey.saved_sessions()
    assert saved and list(saved[-1]["results"]) == [item_id], "部分提交收入了未作答題目"
    assert saved[-1]["results"][item_id]["attempt"]["answer"] == "A", "沒有保留本次提交原答"
    journey.navigate("#/records")
    page.wait_for_selector(".session-entry")
    assert "1" in page.locator(".session-entry").first.inner_text()
    before = json.dumps(journey.saved_sessions(), sort_keys=True)
    journey.navigate("#/library/books/concepts/chem/T1")
    page.wait_for_selector(".ml-page")
    assert "概念" in page.locator("#app").inner_text(), "概念入口未呈現回顧內容"
    recall = page.locator(".ml-recall").first
    assert recall.count() and not recall.evaluate("node => node.open"), "概念答案在回憶前已展開"
    recall.locator("summary").click()
    assert "必要條件" in recall.inner_text(), "揭曉沒有展示已核實原文"
    assert json.dumps(journey.saved_sessions(), sort_keys=True) == before, "閱讀概念寫入了作答證據"
    related = page.locator('#app a[href^="#/drill/"]')
    assert related.count(), "概念回顧沒有連接現有題目的檢驗入口"
    related.first.click()
    page.wait_for_selector(".sq")
    assert page.locator('.sq[data-kind="sub"]').count() == 0, "概念選擇題檢驗包含大題"
    journey.navigate("#/")
    page.wait_for_selector(".continue-command")
    return {"saved_questions": len(saved[-1]["results"]), "concept_reading_preserved_records": True}


def desktop(journey):
    page = journey.home()
    journey.navigate("#/library/books/chem/T1")
    page.wait_for_selector("#mlKind")
    page.locator("#mlKind").select_option("mc")
    page.locator("#mlStatus").select_option("unseen")
    page.locator("#mlSearch").fill("合成物質甲")
    page.wait_for_function("document.querySelectorAll('#mlQuestions .ml-question').length === 1")
    practice = page.locator("#mlFilteredPractice")
    href = practice.get_attribute("href")
    assert href and href.startswith("#/drill/"), "篩選練習仍指向整課題"
    practice.click()
    page.wait_for_selector(".sq")
    assert page.locator(".sq").count() == 1, "實際練習題目超出篩選範圍"
    item_id = journey.select_first_mc()
    page.locator("#submitBtn").click()
    journey.save_result()
    assert list(journey.saved_sessions()[-1]["results"]) == [item_id]
    journey.navigate("#/drill/chem?ids=chem-2022-q-1&back=%23%2Flibrary%2Fbooks%2Fchem%2FT1")
    page.wait_for_selector(".step-input")
    fields = page.locator(".step-input")
    fields.nth(0).fill("本次已寫出必要條件")
    fields.nth(1).fill("本次完整解釋原因")
    page.locator("#submitBtn").click()
    page.wait_for_selector(".chk-form", state="attached")
    for summary in page.locator("details.review-self-check:not([open]) > summary").all():
        summary.click()
    for checkbox in page.locator('.chk-form input[type="checkbox"]').all():
        checkbox.check()
    journey.save_result()
    latest = journey.saved_sessions()[-1]["results"]["chem-2022-q-1"]
    assert "本次完整解釋原因" in latest["attempt"]["answer"]
    assert latest["marks"] == 2
    journey.navigate("#/library/books/question/chem/chem-2022-q-1")
    page.wait_for_selector(".ml-question")
    page.locator(".ml-reveal > summary").click()
    assert "本次完整解釋原因" in page.locator("#app").inner_text(), "題卡沒有提供最近提交原答對照"
    return {"filtered_questions": 1, "subjective_snapshot": True}


def paper(journey):
    page = journey.home()
    def trace(label):
        state = page.evaluate("""() => ({page:document.querySelector('#paperPageSelect')?.value,
          scrollTop:document.querySelector('#contentScroll')?.scrollTop,
          positions:JSON.parse(localStorage.getItem('dse_quiz_reader_position_v1')||'{}')})""")
        journey.paper_trace.append({"stage": label, **state})
    journey.stage = "進入原卷並跳至第一處錯題"
    journey.navigate("#/library/papers/chem/2022")
    page.wait_for_selector("#paperNextMistake:not([disabled])")
    page.locator("#paperNextMistake").click()
    page.wait_for_function("document.querySelector('#paperPageSelect').value === '2'")
    trace("跳至第2頁")
    dock = page.locator("#paperReviewPanel details:not([open]) > summary")
    if dock.count():
        dock.first.click()
    redo = page.locator("#paperRedo")
    assert redo.count(), "原卷錯題位置沒有連接本題重做"
    card = page.locator(".paper-question-link").first
    assert card.count(), "原卷批注沒有連接對應文字錯題卡"
    card.click()
    journey.stage = "查看原卷對應題卡再獨立重做"
    page.wait_for_selector(".ml-question[open]")
    assert not page.locator(".ml-reveal").evaluate("node => node.open"), "原卷轉到題卡後直接洩露解析"
    page.locator(".ml-redo-one").click()
    journey.stage = "原卷單題重做並提交"
    page.wait_for_selector(".sq")
    assert page.locator(".sq").count() == 1, "原卷單題重做收入了整個課題"
    assert journey.select_first_mc() == "chem-2022-mc-1"
    page.locator("#submitBtn").click()
    journey.save_result()
    back = page.locator('a[href*="/library/papers/chem/2022"]')
    assert back.count(), "重做完成後沒有返回原卷入口"
    back.first.click()
    journey.stage = "重做後返回原卷錯題位置"
    page.wait_for_selector("#paperNextMistake:not([disabled])")
    page.wait_for_function("document.querySelector('#paperPageSelect').value === '2'")
    trace("重做後回第2頁")
    zoom = page.locator("#paperOpen, #paperZoom")
    assert zoom.count(), "找不到站內放大本頁入口"
    tools = page.locator("#paperToolsToggle")
    if not zoom.first.is_visible() and tools.count():
        tools.click()
    zoom.first.click()
    journey.stage = "站內放大並關閉"
    page.wait_for_selector("dialog[open], .paper-zoom[open], .paper-zoom-dialog[open]")
    zoom_image = page.locator("dialog[open] .paper-zoom-image")
    zoom_image.wait_for(state="visible")
    old_width = zoom_image.bounding_box()["width"]
    page.get_by_role("button", name="放大本頁", exact=True).click()
    assert zoom_image.bounding_box()["width"] > old_width, "站內放大按鈕沒有擴大頁面"
    page.keyboard.press("Escape")
    page.wait_for_function("!document.querySelector('dialog[open]')")
    assert page.evaluate("document.activeElement.id") == "paperToolsToggle", "關閉放大後未恢復到可見閱讀工具按鈕"
    page.wait_for_timeout(250)
    trace("關閉放大後穩定位置")
    assert page.locator("#paperPageSelect").input_value() == "2", "關閉放大後丟失原閱讀頁碼"
    journey.stage = "換卷後分別恢復各卷閱讀位置"
    journey.navigate("#/library/papers/bio/2022")
    page.wait_for_selector("#paperNextMistake:not([disabled])")
    page.locator("#paperPageSelect").select_option("3")
    page.wait_for_function("document.querySelector('#paperPageSelect').value === '3'")
    trace("切換生物卷第3頁")
    journey.navigate("#/library/papers/chem/2022")
    page.wait_for_selector("#paperNextMistake:not([disabled])")
    trace("切回化學卷")
    page.wait_for_function("document.querySelector('#paperPageSelect').value === '2'")
    page.reload(wait_until="domcontentloaded")
    journey.stage = "刷新恢復原卷錯題位置"
    page.wait_for_selector("#paperNextMistake:not([disabled])")
    page.wait_for_function("document.querySelector('#paperPageSelect').value === '2'")
    assert "#/library/papers/chem/2022" in page.url, "刷新後沒有留在原卷"
    journey.stage = "直接使用手機固定重做入口往返原卷"
    quick = page.locator("#paperQuickRedo")
    assert quick.count() and quick.is_visible(), "手機當前批注缺少固定重做入口"
    quick.click()
    page.wait_for_selector(".sq")
    assert page.locator(".sq").count() == 1
    assert journey.select_first_mc() == "chem-2022-mc-1"
    page.locator("#submitBtn").click()
    journey.save_result()
    page.locator('a[href*="/library/papers/chem/2022"]').first.click()
    page.wait_for_selector("#paperNextMistake:not([disabled])")
    page.wait_for_function("document.querySelector('#paperPageSelect').value === '2'")
    return {"restored_page": 2, "single_question_round_trip": True, "in_place_zoom": True,
            "zoom_focus_restored": True, "separate_paper_positions": True, "mobile_quick_redo": True}


def storage(journey):
    page = journey.home()
    journey.navigate("#/drill/chem?ids=chem-2022-q-1&back=%23%2F")
    page.wait_for_selector(".step-input")
    page.locator(".step-input").first.fill("跨雙周仍應保留的合成草稿")
    page.reload(wait_until="domcontentloaded")
    page.wait_for_selector(".step-input")
    assert page.locator(".step-input").first.input_value() == "跨雙周仍應保留的合成草稿", "刷新丟失未提交答案"
    page.evaluate("localStorage.setItem('dse_quiz_cycle_v1', String(Date.now()-15*864e5))")
    page.reload(wait_until="domcontentloaded")
    page.wait_for_selector(".step-input")
    assert page.locator(".step-input").first.input_value() == "跨雙周仍應保留的合成草稿", "雙周統計換輪刪除了未提交答案"
    assert not journey.saved_sessions(), "未提交草稿被記為已完成練習"
    return {"refresh_draft": True, "cycle_draft": True, "no_phantom_attempt": True}


def accounts(journey):
    page = journey.home()
    page.evaluate("localStorage.setItem('dse_quiz_draft_v2', JSON.stringify({'kyle-only-task':{text:{private:'KYLE_SYNTHETIC_PRIVATE_MARKER'}}}))")
    journey.navigate("#/library/books")
    page.wait_for_selector(".ml-subject")
    hrefs = page.locator(".ml-subject").evaluate_all("nodes => nodes.map(node => node.getAttribute('href'))")
    codes = [href.rsplit("/", 1)[-1] for href in hrefs]
    assert set(codes) == set(ACCOUNT_SUBJECTS[journey.account]), "科目入口超出帳號範圍"
    journey.navigate("#/records")
    page.wait_for_selector("#exportDataBtn")
    assert "KYLE_SYNTHETIC_PRIVATE_MARKER" not in page.locator("#app").inner_text()
    if journey.account == "yeelam":
        assert not journey.saved_sessions()
    return {"account": journey.account, "subjects": sorted(codes), "cross_account_marker_hidden": True}


def matrix(journey):
    page = journey.home()
    checked = []
    routes = ["#/", "#/practice/chem", "#/library/books/chem/T1", "#/records", "#/library/papers/chem/2022"]
    for width, height in [(320, 568), (844, 390), (390, 844), (1440, 1000)]:
        page.set_viewport_size({"width": width, "height": height})
        for appearance, theme in [("full", "day"), ("full", "night"), ("simple", "day")]:
            page.evaluate("value => window.DSEAppearance.setView(value)", appearance)
            page.evaluate("theme => {if(document.documentElement.dataset.theme !== theme) window.DSEAppearance.toggle()}", theme)
            for route in routes:
                journey.navigate(route)
                if "/papers/" in route:
                    page.wait_for_selector("#paperNextMistake:not([disabled])")
                elif "/books/chem/T1" in route:
                    page.wait_for_selector(".ml-question")
                elif "/practice/" in route:
                    page.wait_for_selector(".practice-topic")
                else:
                    page.wait_for_selector(".continue-command" if route == "#/" else "#exportDataBtn")
                overflow = page.evaluate("""() => {
                  const pane=document.querySelector('#contentScroll');
                  return Math.max(document.documentElement.scrollWidth-innerWidth,pane.scrollWidth-pane.clientWidth);
                }""")
                assert overflow <= 2, f"{width}×{height} {appearance}/{theme} {route} 橫向溢出 {overflow}px"
            checked.append(f"{width}x{height}/{appearance}/{theme}")
    return {"responsive_theme_combinations": checked, "routes_per_combination": len(routes)}


def empty(journey):
    page = journey.home()
    assert page.locator(".home-bank-total b").inner_text() == "0"
    primary = page.locator(".continue-command")
    if primary.count():
        primary.click()
        page.wait_for_timeout(150)
        assert page.locator(".sq").count() == 0
        assert page.locator("#app").inner_text().strip(), "空題庫呈現空白頁"
    journey.navigate("#/library/books/concepts")
    page.wait_for_selector(".ml-page")
    assert page.locator("#app").inner_text().strip()
    return {"empty_bank_has_content": True}


def home_scenes(journey):
    page = journey.home()
    page.emulate_media(reduced_motion="no-preference")
    page.evaluate("if (document.documentElement.dataset.theme !== 'night') DSEAppearance.toggle()")
    page.wait_for_timeout(900)
    page.mouse.move(1400, 850)

    def state():
        return page.evaluate("""() => {
          const pane=document.querySelector('#contentScroll');
          const details=document.querySelector('#homeDetails');
          const world=document.querySelector('#visualWorld');
          const scene=document.querySelector('.home-scene');
          return {top:pane.scrollTop, height:pane.clientHeight,
            boundary:details.getBoundingClientRect().top-pane.getBoundingClientRect().top+pane.scrollTop,
            opacity:Number(getComputedStyle(scene).opacity), shade:Number(getComputedStyle(world,'::after').opacity),
            image:getComputedStyle(scene).backgroundImage};
        }""")

    before = state()
    assert not page.locator('.home-next').count(), "首頁仍有 SCROLL 按鈕"
    assert abs(before['boundary'] - before['height']) < 2 and before['opacity'] == 0, repr(before)
    page.mouse.wheel(80, 3)
    page.wait_for_timeout(120)
    assert state()['top'] < 10, "水平觸控板滑動不應翻頁"

    # Small, closely spaced wheel deltas reproduce a trackpad gesture rather
    # than relying on a single large mouse-wheel notch or CSS scroll snapping.
    for _ in range(5):
        page.mouse.wheel(0, 6)
        page.wait_for_timeout(25)
    page.wait_for_timeout(100)
    middle = state()
    assert 0 < middle['top'] < middle['boundary'] and 0 < middle['opacity'] < 1, repr(middle)
    for _ in range(4):
        page.mouse.wheel(0, 4)  # residual momentum must not overshoot the page
        page.wait_for_timeout(25)
    page.wait_for_timeout(700)
    second = state()
    assert abs(second['top'] - second['boundary']) < 2 and second['opacity'] > .99, repr(second)
    assert second['shade'] < .01 and 'archive-night.webp' in second['image'], repr(second)
    assert page.locator('#todayCount').evaluate("""el => {
      const event=new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-50});
      el.dispatchEvent(event); return !event.defaultPrevented;
    }"""), "選擇器內的滾輪不應被翻頁攔截"

    page.evaluate("DSEAppearance.toggle()")
    page.wait_for_timeout(100)
    day = state()
    assert day['shade'] < .01 and 'archive-day.webp' in day['image'], repr(day)
    page.wait_for_timeout(200)
    page.mouse.wheel(0, 55)
    page.wait_for_timeout(160)
    deeper = state()
    assert deeper['top'] > deeper['boundary'] + 10, "第二頁內不能繼續滾動：" + repr(deeper)
    page.mouse.wheel(0, -100)
    page.wait_for_timeout(850)
    assert state()['top'] < 2 and state()['opacity'] < .01, "向上滑動未返回第一頁：" + repr(state())

    # A typical short Mac laptop viewport should still page on one gesture.
    page.set_viewport_size({'width': 1440, 'height': 700})
    page.wait_for_timeout(200)
    page.mouse.move(1400, 500)
    short_before = state()
    assert abs(short_before['boundary'] - short_before['height']) < 2, repr(short_before)
    page.mouse.wheel(0, 40)
    page.wait_for_timeout(850)
    assert abs(state()['top'] - state()['boundary']) < 2, "短窗口未能翻頁：" + repr(state())

    # Reduced motion retains navigation but makes the page change immediate.
    page.wait_for_timeout(250)
    page.emulate_media(reduced_motion='reduce')
    page.mouse.wheel(0, -50)
    page.wait_for_timeout(100)
    assert state()['top'] < 2, "減少動態效果時未即時返回"
    page.wait_for_timeout(220)
    page.mouse.wheel(0, 50)
    page.wait_for_timeout(100)
    assert abs(state()['top'] - state()['boundary']) < 2, "減少動態效果時未即時翻頁"

    # Very short windows can scroll to first-scene content that does not fit.
    page.set_viewport_size({'width': 1440, 'height': 500})
    page.evaluate("document.querySelector('#contentScroll').scrollTop=0")
    page.wait_for_timeout(250)
    cramped = state()
    assert cramped['boundary'] > cramped['height'] + 30, repr(cramped)
    page.mouse.move(1400, 400)
    page.mouse.wheel(0, 45)
    page.wait_for_timeout(150)
    assert 0 < state()['top'] < cramped['boundary'] / 2, "矮窗口應先顯示首屏其餘內容：" + repr(state())
    page.evaluate("document.querySelector('#contentScroll').scrollTop=0; document.querySelector('#app').focus({preventScroll:true})")
    page.keyboard.press('PageDown')
    page.wait_for_timeout(300)
    assert state()['top'] > 0, "鍵盤仍應能滾動主頁"

    # Simplified and mobile layouts retain normal incremental scrolling.
    page.evaluate("DSEAppearance.setView('simple'); document.querySelector('#contentScroll').scrollTop=0")
    page.wait_for_timeout(250)
    page.mouse.wheel(0, 80)
    page.wait_for_timeout(160)
    simple_top = state()['top']
    assert 0 < simple_top < 250, "精簡版不應強制翻頁：" + repr(simple_top)
    page.evaluate("DSEAppearance.setView('full'); document.querySelector('#contentScroll').scrollTop=0")
    page.set_viewport_size({'width': 390, 'height': 844})
    page.wait_for_timeout(200)
    page.mouse.move(370, 500)
    page.mouse.wheel(0, 80)
    page.wait_for_timeout(160)
    mobile_top = state()['top']
    assert 0 < mobile_top < 250, "手機尺寸不應強制翻頁：" + repr(mobile_top)

    # Leaving the home route during animation must not scroll the new page.
    page.set_viewport_size({'width': 1440, 'height': 900})
    page.emulate_media(reduced_motion='no-preference')
    page.evaluate("document.querySelector('#contentScroll').scrollTop=0")
    page.wait_for_timeout(220)
    page.mouse.move(1400, 500)
    page.mouse.wheel(0, 50)
    page.wait_for_timeout(100)
    page.evaluate("location.hash='#/records'")
    page.wait_for_selector('#exportDataBtn')
    page.wait_for_timeout(800)
    assert page.locator('#contentScroll').evaluate('(el) => el.scrollTop') == 0, "換頁動畫影響了其他路由"
    return {"trackpad_deltas": True, "second_page_scroll": True, "day_night_art": True,
            "short_window": True, "keyboard": True, "reduced_motion": True, "simple_mobile": True, "route_cancel": True}


SUITES = {"mobile": mobile, "desktop": desktop, "paper": paper, "storage": storage,
          "accounts": accounts, "matrix": matrix, "empty": empty, "home_scenes": home_scenes}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite", choices=["all", *SUITES], default="all")
    parser.add_argument("--chromium", default=shutil.which("chromium"))
    parser.add_argument("--artifacts", type=pathlib.Path, default=pathlib.Path(tempfile.gettempdir()) / "kyle-experience-failures")
    args = parser.parse_args()
    server = LocalService()
    threading.Thread(target=server.serve_forever, daemon=True).start()
    results = []
    try:
        with sync_playwright() as playwright:
            launch = {"headless": True, "args": ["--no-sandbox"]}
            if args.chromium:
                launch["executable_path"] = args.chromium
            browser = playwright.chromium.launch(**launch)
            for name in SUITES if args.suite == "all" else [args.suite]:
                users = ["kyle", "yeelam"] if name in ("accounts", "home_scenes") else ["kyle"]
                for account in users:
                    journey = Journey(browser, server, name, viewport=(1440, 1000) if name in ["desktop", "storage", "home_scenes"] else (390, 844),
                                      account=account, empty=name == "empty")
                    started = time.monotonic()
                    try:
                        evidence = SUITES[name](journey)
                        journey.no_errors()
                        result = {"suite": name, "account": account, "status": "passed", "evidence": evidence}
                    except Exception as error:
                        if name == "paper":
                            try:
                                journey.paper_trace.append({"stage": "失敗當下", **journey.page.evaluate("""() => ({
                                  page:document.querySelector('#paperPageSelect')?.value,
                                  scrollTop:document.querySelector('#contentScroll')?.scrollTop,
                                  positions:JSON.parse(localStorage.getItem('dse_quiz_reader_position_v1')||'{}'),
                                  sheets:[...document.querySelectorAll('.paper-sheet')].map(node=>({top:node.getBoundingClientRect().top,height:node.getBoundingClientRect().height})),
                                  toolbarBottom:document.querySelector('#paperToolbar')?.getBoundingClientRect().bottom})""")})
                            except Exception:
                                pass
                        args.artifacts.mkdir(parents=True, exist_ok=True)
                        screenshot = args.artifacts / f"{name}-{account}.png"
                        try:
                            journey.page.screenshot(path=str(screenshot))
                        except Exception:
                            screenshot = None
                        result = {"suite": name, "account": account, "status": "failed", "error": str(error),
                                  "stage": journey.stage, "url": journey.page.url, "page_errors": journey.errors,
                                  "paper_trace": journey.paper_trace,
                                  "screenshot": str(screenshot) if screenshot else None}
                    finally:
                        journey.close()
                    result["elapsed_seconds"] = round(time.monotonic() - started, 2)
                    results.append(result)
                    print(json.dumps(result, ensure_ascii=False), flush=True)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    return 1 if any(result["status"] == "failed" for result in results) else 0


if __name__ == "__main__":
    raise SystemExit(main())
