# inup

[![npm version](https://img.shields.io/npm/v/inup?logo=npm&logoColor=%23CB3837&style=for-the-badge&color=crimson)](https://www.npmjs.com/package/inup)
[![Downloads](https://img.shields.io/npm/dm/inup?style=for-the-badge&color=646CFF&logoColor=white)](https://www.npmjs.com/package/inup)
[![Total downloads](https://img.shields.io/npm/dt/inup?style=for-the-badge&color=informational)](https://www.npmjs.com/package/inup)

Interactive upgrade for your dependencies. Works with npm, yarn, pnpm, and bun.

![Interactive Upgrade Demo](docs/demo/interactive-upgrade.gif)

## Install

```bash
npx inup
```

Or install globally:

```bash
npm install -g inup
```

## Usage

```bash
npx inup
```

That's it. The tool scans your project, finds outdated packages, and lets you pick what to upgrade.

## Features

- Auto-detects package manager (npm, yarn, pnpm, bun)
- Works with monorepos and workspaces
- Batch upgrades with keyboard shortcuts
- Search packages with `/`
- Multiple themes (press `t`)
- Package info modal (press `i`)

## Keyboard Shortcuts

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

## Options

```bash
inup [options]

-d, --dir <path>              Run in specific directory
-e, --exclude <patterns>      Skip directories (comma-separated regex)
-p, --peer                    Include peer dependencies
-o, --optional                Include optional dependencies
--package-manager <name>      Force package manager (npm, yarn, pnpm, bun)
```

## License

MIT
