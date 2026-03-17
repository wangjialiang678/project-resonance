"""P1 Closed-loop tests for project-resonance UX fixes + ASR migration."""
import sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8086"
RESULTS = []

def record(name, passed, detail=""):
    status = "PASS" if passed else "FAIL"
    RESULTS.append((name, status, detail))
    print(f"  [{status}] {name}" + (f" — {detail}" if detail else ""))

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # ===== Test 1: Onboarding has 3 steps, no training step =====
        print("\n--- P1-1: Onboarding flow ---")
        ctx = browser.new_context(viewport={"width": 1280, "height": 720})
        page = ctx.new_page()
        page.goto(BASE)
        page.wait_for_load_state("networkidle")

        # Should show welcome page (no onboarding_done in localStorage)
        welcome_text = page.text_content("body")
        has_welcome = "欢迎使用" in welcome_text
        record("P1-1a: Welcome page shown", has_welcome,
               "Found '欢迎使用'" if has_welcome else f"Body: {welcome_text[:100]}")

        # Check step indicators - should be 3 dots
        dots = page.query_selector_all("button.rounded-full")
        # Filter to step indicator dots (small ones)
        step_dots = [d for d in dots if "w-2" in (d.get_attribute("class") or "") or "w-8" in (d.get_attribute("class") or "")]
        record("P1-1b: 3 onboarding steps", len(step_dots) == 3,
               f"Found {len(step_dots)} step dots")

        # Check no "录音训练" text
        has_training = "录音训练" in welcome_text
        record("P1-1c: No '录音训练' step", not has_training,
               "Not found (good)" if not has_training else "Found '录音训练' — should be removed")

        # Navigate to last step
        next_btn = page.query_selector("text=下一步")
        if next_btn:
            next_btn.click()
            page.wait_for_timeout(400)
            next_btn2 = page.query_selector("text=下一步")
            if next_btn2:
                next_btn2.click()
                page.wait_for_timeout(400)

        # Last step should have "开始使用" button
        body_text = page.text_content("body")
        has_start_using = "开始使用" in body_text
        record("P1-1d: Final button says '开始使用'", has_start_using,
               "Found '开始使用'" if has_start_using else f"Body: {body_text[:200]}")

        # Click "开始使用" - should navigate to /
        start_btn = page.query_selector("text=开始使用")
        if start_btn:
            start_btn.click()
            page.wait_for_timeout(500)
            url_after = page.url
            record("P1-1e: Navigate to / after onboarding", url_after.rstrip("/").endswith(":8086") or url_after.endswith("/"),
                   f"URL: {url_after}")
        else:
            record("P1-1e: Navigate to / after onboarding", False, "Could not find '开始使用' button")

        ctx.close()

        # ===== Test 2: Usage page shows voice clone hint =====
        print("\n--- P1-2: Usage page ---")
        ctx = browser.new_context(viewport={"width": 1280, "height": 720})
        page = ctx.new_page()
        page.goto(BASE)
        page.wait_for_load_state("networkidle")
        page.evaluate("() => localStorage.setItem('resonance_onboarding_done', 'true')")
        page.goto(BASE)
        page.wait_for_load_state("networkidle")

        body = page.text_content("body")
        has_voice_hint = "首次录音" in body
        record("P1-2a: Usage page shows first-time voice hint", has_voice_hint,
               "Found '首次录音'" if has_voice_hint else f"Body: {body[:200]}")

        has_asr_title = "语音识别" in body
        record("P1-2b: Usage page shows '语音识别' heading", has_asr_title)

        ctx.close()

        # ===== Test 3: Settings page has voice clone panel =====
        print("\n--- P1-3: Settings page ---")
        ctx = browser.new_context(viewport={"width": 1280, "height": 720})
        page = ctx.new_page()
        page.goto(BASE)
        page.wait_for_load_state("networkidle")
        page.evaluate("() => localStorage.setItem('resonance_onboarding_done', 'true')")
        page.goto(BASE + "/settings")
        page.wait_for_load_state("networkidle")

        body = page.text_content("body")
        has_clone = "声音克隆" in body
        record("P1-3a: Settings shows voice clone section", has_clone,
               "Found '声音克隆'" if has_clone else f"Body: {body[:200]}")

        has_no_stepfun = "stepfun" not in body.lower() and "阶跃" not in body
        record("P1-3b: No StepFun references in settings", has_no_stepfun,
               "Clean" if has_no_stepfun else "Found StepFun reference!")

        ctx.close()

        # ===== Test 4: Build output has no StepFun API key =====
        print("\n--- P1-4: Security check ---")
        import subprocess
        result = subprocess.run(
            ["grep", "-r", "VITE_STEPFUN_API_KEY", "dist/assets/"],
            capture_output=True, text=True,
            cwd="/Users/michael/SuperBrain 超脑/project-resonance/.claude/worktrees/agent-a417ebcb"
        )
        has_key = bool(result.stdout.strip())
        record("P1-4a: No STEPFUN_API_KEY in JS build", not has_key,
               "Clean" if not has_key else f"Found: {result.stdout[:100]}")

        browser.close()

    # ===== Summary =====
    print("\n" + "=" * 50)
    passed = sum(1 for _, s, _ in RESULTS if s == "PASS")
    total = len(RESULTS)
    print(f"Results: {passed}/{total} passed")
    for name, status, detail in RESULTS:
        print(f"  [{status}] {name}" + (f" — {detail}" if detail else ""))

    if passed < total:
        print("\nFAILED tests detected!")
        sys.exit(1)
    else:
        print("\nAll P1 tests PASSED!")
        sys.exit(0)

if __name__ == "__main__":
    main()
