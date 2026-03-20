# NotebookZrss

A Hexo + NexT blog project.

## 1) Prerequisites

- Git
- Node.js LTS (recommend 18 LTS, require >= 18)
- npm (comes with Node.js)

Check versions:

```bash
node -v
npm -v
git --version
```

## 2) Clone and install

```bash
git clone git@github.com:zrss/zrss.github.io.git
cd zrss.github.io
git checkout hexo
npm ci
```

Notes:

- Use `npm ci` to install exactly from `package-lock.json` for consistent UI behavior across machines.
- If `npm ci` fails because local lockfile was changed, run `git pull` and retry.

## 3) Run locally

```bash
npx hexo clean
npx hexo s
```

Open:

- [http://localhost:4000](http://localhost:4000)

## 4) Create new post

```bash
npx hexo new "your-post-title"
```

The scaffold includes `date: {{ date }}`, so date is auto-generated.

## 5) Build static files

```bash
npx hexo generate
```

Generated output is in `public/`.

## 6) Deploy

```bash
npx hexo deploy
```

Deployment target is configured in `_config.yml` under `deploy`.

## 7) Common troubleshooting

- **Template error (`escape_html` undefined)**  
  Ensure `scripts/helpers/escape-html-compat.js` exists, then restart Hexo server.

- **Config changed but UI not updated**  
  Stop server and rerun:
  ```bash
  npx hexo clean
  npx hexo s
  ```

- **Dependency mismatch between machines**  
  Use same Node major version and always run `npm ci`.

