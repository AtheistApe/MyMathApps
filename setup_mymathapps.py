#!/usr/bin/env python3
"""
setup_mymathapps.py

One-time (and re-runnable) setup script that turns a folder of Vite/React
apps into a single GitHub repo deployed for free on GitHub Pages, with a
GitHub Actions workflow that builds every app and publishes them all under
one site.

Expected layout, run FROM INSIDE the parent folder (e.g. MyMathApps/):

    MyMathApps/
        riemann-sum-visualizer/     <- existing Vite project (package.json, vite.config.js, src/, ...)
        newtons-method-explorer/
        polar-curve-explorer/
        ...

What it does, safely and repeatably:
  1. Finds every subfolder that looks like a Vite app.
  2. Sets/updates `base: '/MyMathApps/<app-name>/'` in each app's vite config,
     so built asset paths resolve correctly under GitHub Pages.
  3. Writes .github/workflows/deploy.yml which, on every push to main,
     builds each app and deploys the combined output via GitHub Actions
     (no gh-pages branch, no manual `npm run deploy`).
  4. Writes a simple index.html at the repo root linking to each app.
  5. Creates the GitHub repo (via `gh repo create`) if it doesn't exist yet,
     and points GitHub Pages at "GitHub Actions" as the build source.
  6. Commits and pushes.

Requirements on your machine: git, gh (already authenticated via
`gh auth login`), python3. Nothing else — the actual `npm install`/`npm run
build` steps run in GitHub's CI, not locally, so you don't need Node
installed to run this script.

Usage:
    cd ~/path/to/MyMathApps
    python3 setup_mymathapps.py                # public repo named MyMathApps
    python3 setup_mymathapps.py --private       # private repo
    python3 setup_mymathapps.py --repo-name Foo  # different repo name

Re-run any time you add a new app subfolder — it only changes what needs
changing and skips the rest.
"""

import argparse
import re
import subprocess
import sys
from pathlib import Path

DEFAULT_REPO_NAME = "MyMathApps"
WORKFLOW_PATH = Path(".github/workflows/deploy.yml")
INDEX_PATH = Path("index.html")


def run(cmd, **kwargs):
    """Run a command, echo it, raise on failure."""
    print(f"$ {' '.join(cmd)}")
    return subprocess.run(cmd, check=True, text=True, **kwargs)


def gh_username() -> str:
    result = subprocess.run(
        ["gh", "api", "user", "--jq", ".login"],
        check=True, text=True, capture_output=True,
    )
    return result.stdout.strip()


def find_app_dirs(root: Path):
    """Any immediate subfolder with package.json + a vite config is an app."""
    apps = []
    for child in sorted(root.iterdir()):
        if not child.is_dir() or child.name.startswith("."):
            continue
        has_pkg = (child / "package.json").exists()
        has_vite_cfg = (child / "vite.config.js").exists() or (child / "vite.config.ts").exists()
        if has_pkg and has_vite_cfg:
            apps.append(child)
    return apps


def patch_vite_base(app_dir: Path, repo_name: str):
    """Ensure vite.config.(js|ts) sets base: '/<repo>/<app>/'."""
    cfg_path = app_dir / "vite.config.js"
    if not cfg_path.exists():
        cfg_path = app_dir / "vite.config.ts"
    if not cfg_path.exists():
        print(f"  ! no vite.config found in {app_dir.name}, skipping")
        return

    text = cfg_path.read_text()
    desired_base = f"/{repo_name}/{app_dir.name}/"

    if re.search(r"base\s*:\s*['\"].*?['\"]", text):
        new_text = re.sub(
            r"base\s*:\s*['\"].*?['\"]",
            f"base: '{desired_base}'",
            text,
            count=1,
        )
    else:
        new_text = re.sub(
            r"defineConfig\(\{",
            f"defineConfig({{\n  base: '{desired_base}',",
            text,
            count=1,
        )
        if new_text == text:
            print(f"  ! couldn't find defineConfig({{...}}) in {cfg_path.name} — add `base: '{desired_base}'` manually")
            return

    if new_text != text:
        cfg_path.write_text(new_text)
        print(f"  set base = '{desired_base}' in {app_dir.name}/{cfg_path.name}")
    else:
        print(f"  base already correct in {app_dir.name}/{cfg_path.name}")


def write_workflow(apps, repo_name: str):
    WORKFLOW_PATH.parent.mkdir(parents=True, exist_ok=True)
    app_names = [a.name for a in apps]

    build_steps = "\n".join(
        f"""
      - name: Build {name}
        working-directory: {name}
        run: |
          npm ci
          npm run build

      - name: Copy {name} into combined site
        run: |
          mkdir -p _site/{name}
          cp -r {name}/dist/* _site/{name}/"""
        for name in app_names
    )

    workflow = f"""name: Deploy {repo_name} to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
{build_steps}

      - name: Copy landing page
        run: cp index.html _site/index.html

      - uses: actions/upload-pages-artifact@v3
        with:
          path: _site

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{{{ steps.deployment.outputs.page_url }}}}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
"""
    WORKFLOW_PATH.write_text(workflow)
    print(f"wrote {WORKFLOW_PATH}")


def write_index(apps, repo_name: str):
    links = "\n".join(
        f'      <li><a href="./{a.name}/">{a.name.replace("-", " ").title()}</a></li>'
        for a in apps
    )
    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>{repo_name}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body {{ font-family: system-ui, sans-serif; max-width: 640px; margin: 3rem auto; padding: 0 1rem; }}
    li {{ margin: 0.4rem 0; font-size: 1.1rem; }}
  </style>
</head>
<body>
  <h1>{repo_name}</h1>
  <ul>
{links}
  </ul>
</body>
</html>
"""
    INDEX_PATH.write_text(html)
    print(f"wrote {INDEX_PATH}")


def ensure_git_repo():
    if not Path(".git").exists():
        run(["git", "init"])
        run(["git", "branch", "-M", "main"])


def ensure_github_repo(repo_name: str, username: str, private: bool):
    check = subprocess.run(
        ["gh", "repo", "view", f"{username}/{repo_name}"],
        capture_output=True, text=True,
    )
    if check.returncode != 0:
        visibility = "--private" if private else "--public"
        run(["gh", "repo", "create", f"{username}/{repo_name}", visibility, "--source=.", "--remote=origin"])
    else:
        remotes = subprocess.run(["git", "remote"], capture_output=True, text=True).stdout.split()
        if "origin" not in remotes:
            run(["git", "remote", "add", "origin", f"https://github.com/{username}/{repo_name}.git"])
        print(f"repo {username}/{repo_name} already exists on GitHub, reusing it")


def enable_pages_via_actions(repo_name: str, username: str):
    endpoint = f"repos/{username}/{repo_name}/pages"
    created = subprocess.run(
        ["gh", "api", endpoint, "-X", "POST", "-f", "build_type=workflow"],
        capture_output=True, text=True,
    )
    if created.returncode != 0:
        # Pages site likely already exists -> make sure it's set to Actions build mode
        run(["gh", "api", endpoint, "-X", "PUT", "-f", "build_type=workflow"])
    print("GitHub Pages set to build from GitHub Actions")


def commit_and_push():
    run(["git", "add", "-A"])
    nothing_to_commit = subprocess.run(["git", "diff", "--cached", "--quiet"]).returncode == 0
    if nothing_to_commit:
        print("nothing new to commit")
        return
    run(["git", "commit", "-m", "Configure GitHub Pages deployment"])
    run(["git", "push", "-u", "origin", "main"])


def main():
    parser = argparse.ArgumentParser(description="Consolidate Vite calculus apps into one GitHub Pages site.")
    parser.add_argument("--repo-name", default=DEFAULT_REPO_NAME, help="GitHub repo name (default: MyMathApps)")
    parser.add_argument("--private", action="store_true", help="create the GitHub repo as private")
    args = parser.parse_args()

    root = Path.cwd()
    apps = find_app_dirs(root)
    if not apps:
        sys.exit(
            "No Vite app subfolders found here. Run this from inside your "
            "MyMathApps/ folder, with each app as a subfolder."
        )

    print(f"Found {len(apps)} app(s): {', '.join(a.name for a in apps)}\n")

    username = gh_username()
    print(f"GitHub user: {username}\n")

    for app in apps:
        patch_vite_base(app, args.repo_name)

    write_workflow(apps, args.repo_name)
    write_index(apps, args.repo_name)

    ensure_git_repo()
    ensure_github_repo(args.repo_name, username, args.private)
    enable_pages_via_actions(args.repo_name, username)
    commit_and_push()

    print(f"\nDone. Once the Actions workflow finishes (check the Actions tab), your apps will be live at:")
    print(f"  https://{username}.github.io/{args.repo_name}/")
    for app in apps:
        print(f"    -> {app.name}: https://{username}.github.io/{args.repo_name}/{app.name}/")


if __name__ == "__main__":
    main()
