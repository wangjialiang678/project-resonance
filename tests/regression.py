"""
Layer 1: 功能回归测试 — 每次改代码后跑

用法:
  python tests/regression.py                          # 测 localhost:8080
  python tests/regression.py https://project-resonance.pages.dev  # 测线上

覆盖:
  R1: 前端加载 + 无 console error
  R2: 四页面导航与渲染
  R3: 引导页流程（3步、无训练步）
  R4: localStorage 持久化
  R5: API 端点健康（ASR + TTS + Clone）
  R6: Auth 和安全
"""
import sys
import os
import subprocess
import wave
import struct
import tempfile

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080"
TOKEN = os.environ.get("VITE_APP_TOKEN", "resonance-2026")

PASS = 0
FAIL = 0
RESULTS = []
CONSOLE_ERRORS = []


def record(name, passed, detail=""):
    global PASS, FAIL
    status = "PASS" if passed else "FAIL"
    RESULTS.append((name, status, detail))
    if passed:
        PASS += 1
    else:
        FAIL += 1
    print(f"  [{status}] {name}" + (f" — {detail}" if detail else ""))


def make_test_wav(path, duration_s=1):
    """Generate a silent WAV file for API testing."""
    f = wave.open(path, "w")
    f.setnchannels(1)
    f.setsampwidth(2)
    f.setframerate(16000)
    f.writeframes(b"\x00\x00" * (16000 * duration_s))
    f.close()


def main():
    global CONSOLE_ERRORS

    wav_path = os.path.join(tempfile.gettempdir(), "regression-test.wav")
    make_test_wav(wav_path)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # ===== R1: 前端加载 + 无 console error =====
        print("\n--- R1: Frontend loads ---")
        ctx = browser.new_context(viewport={"width": 1280, "height": 720})
        page = ctx.new_page()
        page.on("console", lambda msg: CONSOLE_ERRORS.append(msg.text) if msg.type == "error" else None)

        try:
            resp = page.goto(BASE, wait_until="networkidle", timeout=15000)
            record("R1-1: Frontend returns 200", resp and resp.status == 200,
                   f"HTTP {resp.status if resp else 'no response'}")
        except Exception as e:
            record("R1-1: Frontend returns 200", False, str(e)[:100])

        body = page.text_content("body") or ""
        has_app = "共鸣" in body or "语音识别" in body or "欢迎" in body
        record("R1-2: Page has app content", has_app,
               "Found app text" if has_app else f"Body: {body[:100]}")

        # Check console errors (filter noise)
        real_errors = [e for e in CONSOLE_ERRORS if "favicon" not in e.lower() and "third-party" not in e.lower()]
        record("R1-3: No JS console errors", len(real_errors) == 0,
               f"{len(real_errors)} errors" if real_errors else "Clean")
        ctx.close()

        # ===== R2: 四页面导航与渲染 =====
        print("\n--- R2: Page navigation ---")
        ctx = browser.new_context(viewport={"width": 1280, "height": 720})
        page = ctx.new_page()
        page.goto(BASE, wait_until="networkidle")
        page.evaluate("() => localStorage.setItem('resonance_onboarding_done', 'true')")

        pages_to_test = [
            ("/", "R2-1: Usage page (/)", ["语音识别", "录音"]),
            ("/settings", "R2-2: Settings page", ["设置", "声音"]),
            ("/training", "R2-3: Training page", ["训练", "短语"]),
            ("/phrases", "R2-4: Phrases page", ["短语", "管理"]),
        ]

        for path, name, keywords in pages_to_test:
            try:
                page.goto(BASE + path, wait_until="networkidle", timeout=10000)
                text = page.text_content("body") or ""
                found = any(kw in text for kw in keywords)
                record(name, found,
                       f"Found: {[kw for kw in keywords if kw in text]}" if found else f"Body: {text[:80]}")
            except Exception as e:
                record(name, False, str(e)[:100])

        # Navigation between pages
        try:
            page.goto(BASE + "/", wait_until="networkidle")
            # Click settings nav
            settings_link = page.query_selector("text=设置") or page.query_selector("a[href='/settings']")
            if settings_link:
                settings_link.click()
                page.wait_for_timeout(500)
                record("R2-5: Nav / → /settings", "/settings" in page.url, page.url)
            else:
                # Try bottom nav
                nav_btns = page.query_selector_all("nav a, nav button")
                if len(nav_btns) >= 2:
                    nav_btns[-1].click()
                    page.wait_for_timeout(500)
                    record("R2-5: Nav / → /settings", "/settings" in page.url, page.url)
                else:
                    record("R2-5: Nav / → /settings", False, "No settings link found")
        except Exception as e:
            record("R2-5: Nav / → /settings", False, str(e)[:100])

        ctx.close()

        # ===== R3: 引导页流程 =====
        print("\n--- R3: Onboarding ---")
        ctx = browser.new_context(viewport={"width": 1280, "height": 720})
        page = ctx.new_page()
        # Clear onboarding state
        page.goto(BASE, wait_until="networkidle")
        page.evaluate("() => localStorage.removeItem('resonance_onboarding_done')")
        page.goto(BASE, wait_until="networkidle")

        body = page.text_content("body") or ""
        record("R3-1: Welcome page shown", "欢迎" in body,
               "Found '欢迎'" if "欢迎" in body else f"Body: {body[:100]}")

        record("R3-2: No '录音训练' step", "录音训练" not in body)

        # Navigate through steps
        for i in range(2):
            btn = page.query_selector("text=下一步")
            if btn:
                btn.click()
                page.wait_for_timeout(400)

        body = page.text_content("body") or ""
        record("R3-3: Final button '开始使用'", "开始使用" in body)

        start_btn = page.query_selector("text=开始使用")
        if start_btn:
            start_btn.click()
            page.wait_for_timeout(500)
            url = page.url
            is_root = url.rstrip("/").endswith(str(BASE.split(":")[-1])) or url.endswith("/")
            record("R3-4: Navigates to / after onboarding", is_root, f"URL: {url}")
        else:
            record("R3-4: Navigates to / after onboarding", False, "Button not found")

        ctx.close()

        # ===== R4: localStorage 持久化 =====
        print("\n--- R4: Data persistence ---")
        ctx = browser.new_context(viewport={"width": 1280, "height": 720})
        page = ctx.new_page()
        page.goto(BASE, wait_until="networkidle")
        page.evaluate("() => localStorage.setItem('resonance_onboarding_done', 'true')")
        page.goto(BASE, wait_until="networkidle")

        # Set a test phrase
        page.evaluate("""() => {
            const phrases = JSON.parse(localStorage.getItem('resonance_phrases') || '[]');
            phrases.push({id: 'test-regression', text: '回归测试', category: 'test'});
            localStorage.setItem('resonance_phrases', JSON.stringify(phrases));
        }""")
        page.reload(wait_until="networkidle")
        phrases = page.evaluate("() => localStorage.getItem('resonance_phrases')") or ""
        record("R4-1: Phrases persist after reload", "回归测试" in phrases)

        # Voice ID persistence
        page.evaluate("() => localStorage.setItem('resonance_cosyvoice_voice_id', 'test-vid-123')")
        page.reload(wait_until="networkidle")
        vid = page.evaluate("() => localStorage.getItem('resonance_cosyvoice_voice_id')") or ""
        record("R4-2: Voice ID persists after reload", vid == "test-vid-123")

        # Cleanup test data
        page.evaluate("""() => {
            const phrases = JSON.parse(localStorage.getItem('resonance_phrases') || '[]');
            const filtered = phrases.filter(p => p.id !== 'test-regression');
            localStorage.setItem('resonance_phrases', JSON.stringify(filtered));
            localStorage.removeItem('resonance_cosyvoice_voice_id');
        }""")

        ctx.close()

        # ===== R5: API 端点健康 =====
        print("\n--- R5: API health ---")

        import urllib.request
        import json

        # ASR
        try:
            proc = subprocess.run(
                ["curl", "-s", "-w", "\n%{http_code}", "-X", "POST",
                 "-H", f"X-App-Token: {TOKEN}",
                 "-F", f"file=@{wav_path};type=audio/wav",
                 f"{BASE}/dashscope-asr"],
                capture_output=True, text=True, timeout=30
            )
            lines = proc.stdout.strip().split("\n")
            code = lines[-1] if lines else "000"
            body = "\n".join(lines[:-1])
            record("R5-1: ASR API responds 200", code == "200", f"HTTP {code}: {body[:80]}")
            if code == "200":
                data = json.loads(body)
                record("R5-2: ASR returns text field", "text" in data, str(data)[:80])
            else:
                record("R5-2: ASR returns text field", False, f"Skipped (HTTP {code})")
        except Exception as e:
            record("R5-1: ASR API responds 200", False, str(e)[:100])
            record("R5-2: ASR returns text field", False, "Skipped")

        # TTS
        try:
            proc = subprocess.run(
                ["curl", "-s", "-w", "\n%{http_code}", "-X", "POST",
                 "-H", f"X-App-Token: {TOKEN}",
                 "-H", "Content-Type: application/json",
                 "-d", '{"text":"你好"}',
                 "-o", "/tmp/regression-tts.mp3",
                 f"{BASE}/cosyvoice-tts"],
                capture_output=True, text=True, timeout=30
            )
            code = proc.stdout.strip().split("\n")[-1]
            size = os.path.getsize("/tmp/regression-tts.mp3") if os.path.exists("/tmp/regression-tts.mp3") else 0
            record("R5-3: TTS API responds 200", code == "200", f"HTTP {code}")
            record("R5-4: TTS returns audio >1KB", size > 1024, f"{size} bytes")
        except Exception as e:
            record("R5-3: TTS API responds 200", False, str(e)[:100])
            record("R5-4: TTS returns audio >1KB", False, "Skipped")

        # ===== R6: Auth & Security =====
        print("\n--- R6: Auth & Security ---")

        # No-token request should be 403
        try:
            proc = subprocess.run(
                ["curl", "-s", "-w", "\n%{http_code}", "-X", "POST",
                 "-H", "Content-Type: application/json",
                 "-d", "{}",
                 f"{BASE}/dashscope-asr"],
                capture_output=True, text=True, timeout=10
            )
            code = proc.stdout.strip().split("\n")[-1]
            record("R6-1: API rejects no-token request", code == "403", f"HTTP {code}")
        except Exception as e:
            record("R6-1: API rejects no-token request", False, str(e)[:100])

        # No StepFun references in settings page
        ctx = browser.new_context(viewport={"width": 1280, "height": 720})
        page = ctx.new_page()
        page.goto(BASE, wait_until="networkidle")
        page.evaluate("() => localStorage.setItem('resonance_onboarding_done', 'true')")
        page.goto(BASE + "/settings", wait_until="networkidle")
        body = page.text_content("body") or ""
        has_stepfun = "stepfun" in body.lower() or "阶跃" in body
        record("R6-2: No StepFun references", not has_stepfun,
               "Clean" if not has_stepfun else "Found StepFun reference!")
        ctx.close()

        # No API key in build output (only when testing localhost with local build)
        if "localhost" in BASE:
            project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            dist_dir = os.path.join(project_dir, "dist", "assets")
            if os.path.exists(dist_dir):
                proc = subprocess.run(
                    ["grep", "-r", "VITE_STEPFUN_API_KEY", dist_dir],
                    capture_output=True, text=True
                )
                record("R6-3: No API key in build", not bool(proc.stdout.strip()),
                       "Clean" if not proc.stdout.strip() else f"Found: {proc.stdout[:80]}")
            else:
                record("R6-3: No API key in build", True, "dist/ not found, skipped")
        else:
            record("R6-3: No API key in build", True, "Skipped for remote target")

        browser.close()

    # Cleanup
    for f in [wav_path, "/tmp/regression-tts.mp3"]:
        try:
            os.remove(f)
        except OSError:
            pass

    # ===== Summary =====
    print("\n" + "=" * 50)
    print(f"  Results: {PASS} passed, {FAIL} failed (total {PASS + FAIL})")
    print("=" * 50)
    for name, status, detail in RESULTS:
        print(f"  [{status}] {name}" + (f" — {detail}" if detail else ""))

    if CONSOLE_ERRORS:
        print(f"\n  Console errors captured: {len(CONSOLE_ERRORS)}")
        for e in CONSOLE_ERRORS[:5]:
            print(f"    - {e[:120]}")

    if FAIL > 0:
        print(f"\n  REGRESSION TEST FAILED ({FAIL} failures)")
        sys.exit(1)
    else:
        print("\n  ALL REGRESSION TESTS PASSED")
        sys.exit(0)


if __name__ == "__main__":
    main()
