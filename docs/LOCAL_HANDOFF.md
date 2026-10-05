# Local development and public GitHub handoff

This project is portable to a Mac mini or Windows PC. No remote connection to either computer has been made.

1. Extract the project and install Node.js 22 or newer.
2. Run `npm ci`, `npm test`, and `npm start` in the project folder.
3. Open http://127.0.0.1:5173 and run the device benchmark.
4. Install/open Codex in this folder. `.codex/config.toml` requests `gpt-6.1-sol` with `high` reasoning. Verify the selected model in the local client; this file does not change the model of an existing ChatGPT conversation.
5. Open Claude Code in the same folder. Select the requested Opus 5.5/high configuration if your account offers it, and provide `docs/CLAUDE_REVIEW_BRIEF.md`. That independent review has not yet been performed.
6. Have Codex assess the review findings, fix substantive issues, rerun numerical checks and browser QA, and update the report.

## Publish to the requested repository

The user created the public repository `kamia121/ARDS_sim`. Clone it locally instead of creating another repository:

```sh
git clone https://github.com/kamia121/ARDS_sim.git
cd ARDS_sim
npm ci
npm test
npm start
```

No credentials should be placed in project files. The application retains the display name ARDS_sim_kh; its repository is ARDS_sim.

In GitHub repository Settings → Pages, choose **GitHub Actions** as the source. Run the **Deploy Pages** workflow. The intended address is https://kamia121.github.io/ARDS_sim/ after deployment succeeds; this is not a currently verified live URL. The workflow runs tests before building and deploying the static site.

Benchmarks on the Mac and PC should be recorded separately with hardware, runtime, raw samples, and date. Browser layout emulation is not a measurement of mobile-device speed.
