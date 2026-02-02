# Git Guide (Setup + Daily Use)

This project is currently **not** a Git repository yet (no `.git/` folder found).

## 0) One-time setup (recommended)

### Configure your identity
Run these once on your machine:

```bash
git config --global user.name "YOUR NAME"
git config --global user.email "you@example.com"
```

### Choose HTTPS vs SSH

- Use **HTTPS** if you don’t want to deal with SSH keys.
- Use **SSH** if you want a smoother experience long-term.

## 1) Create a new Git repo for this folder

From the project root:

```bash
git init
```

## 2) Add a `.gitignore` (important)

You should ignore at least:

- `node_modules/`
- build output (`dist/`)
- local env files (`.env*`)
- caches (`.cache/`, `.vite/`, etc.)
- Python venvs (`.venv/`) if present
- Freqtrade output / backtest artifacts if you don’t want them committed (`user_data/backtest_results/`, exports)

If you want, I can generate a `.gitignore` tailored to this repo.

## 3) First commit

```bash
git add -A
git commit -m "Initial commit"
```

## 4) Connect to your remote (GitHub / GitLab)

### Create an empty repo on your Git host
On GitHub/GitLab, create a new repository **without** README/License (so it’s empty).

### Add the remote
Pick ONE of the following.

#### Option A: HTTPS
```bash
git remote add origin https://github.com/<USER>/<REPO>.git
```

#### Option B: SSH
```bash
git remote add origin git@github.com:<USER>/<REPO>.git
```

### Push
Your default branch name might be `main` or `master`.

```bash
git branch -M main
git push -u origin main
```

## 5) Daily workflow (recommended)

### See what changed
```bash
git status
```

### Commit changes
```bash
git add -A
git commit -m "Describe what changed"
```

### Pull before you push (if you work on multiple machines)
```bash
git pull --rebase
```

### Push
```bash
git push
```

## 6) Branch workflow (feature branches)

```bash
git checkout -b feature/advanced-metrics
# ...make changes...
git add -A
git commit -m "Add advanced metrics"
git push -u origin feature/advanced-metrics
```

Then open a Pull Request on GitHub/GitLab.

## 7) Common fixes

### Undo unstaged changes
```bash
git restore .
```

### Unstage files
```bash
git restore --staged .
```

### Fix a bad commit message (last commit)
```bash
git commit --amend
```

### Resolve conflicts
- Open the conflicted files.
- Choose the correct version.
- Then:

```bash
git add -A
git commit
```

---

## What I need from you to “add your git” now
Reply with:

1) **Git host**: GitHub or GitLab?
2) **Remote URL** (HTTPS or SSH) you want to use.

Then I’ll guide you through the exact commands to run safely.
