# 🚀 inup

[![npm version](https://img.shields.io/npm/v/inup?logo=npm&logoColor=%23CB3837&style=for-the-badge&color=crimson)](https://www.npmjs.com/package/inup)
[![Downloads](https://img.shields.io/npm/dm/inup?style=for-the-badge&color=646CFF&logoColor=white)](https://www.npmjs.com/package/inup)
[![Total downloads](https://img.shields.io/npm/dt/inup?style=for-the-badge&color=informational)](https://www.npmjs.com/package/inup)

Upgrade your dependencies interactively. Works with npm, yarn, pnpm, and bun.

![Interactive Upgrade Demo](docs/demo/interactive-upgrade.gif)

## 🚀 Usage

```bash
npx inup
```

Or install globally:

```bash
npm install -g inup
```

That's it. The tool scans your project, finds outdated packages, and lets you pick what to upgrade.

## 💡 Why inup?

- **Inclusive by Default**: We load Dev, Peer, and Optional dependencies automatically. No more restarting the tool because you forgot a `--peer` flag.
- **Live Toggles**: Toggle dependency types (`d`, `p`, `o`) on the fly without exiting.
- **Zero Config**: Auto-detects your package manager.
- **Monorepo Ready**: Seamlessly handles workspaces.
- **Modern UX**: Search with `/`, view package details with `i`, and swap themes with `t`.

## ⌨️ Keyboard Shortcuts

- `↑/↓` - Navigate packages
- `←/→` - Select version (current, patch, minor, major)
- `Space` - Toggle selection
- `m` - Select all minor updates
- `l` - Select all latest updates
- `u` - Unselect all
- `/` - Search packages
- `t` - Change theme
- `i` - View package info
- `Enter` - Confirm and upgrade

## ⚙️ Options

```bash
inup [options]

-d, --dir <path>              Run in specific directory
-e, --exclude <patterns>      Skip directories (comma-separated regex)
--package-manager <name>      Force package manager (npm, yarn, pnpm, bun)
```

## 🔒 Privacy

We don't track anything. Ever.

The only network requests made are to the npm registry and jsDelivr CDN to fetch package version data. That's it.

## 📄 License

MIT
