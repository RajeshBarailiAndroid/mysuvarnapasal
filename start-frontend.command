#!/bin/bash
# SubarnaPasal — start the app screen (double-click me AFTER start-backend.command)
cd "$(dirname "$0")" || exit 1

# Put Homebrew on the PATH
[ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"
[ -x /usr/local/bin/brew ] && eval "$(/usr/local/bin/brew shellenv)"

# Make sure Node.js and pnpm are installed
command -v node >/dev/null 2>&1 || { echo "Installing Node.js (one-time, a few minutes)..."; brew install node || exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "Installing pnpm (one-time)..."; brew install pnpm || exit 1; }

# Make sure project packages are installed
[ -d node_modules/.pnpm ] || { echo "Installing app packages (one-time)..."; pnpm install || exit 1; }

echo "=============================================="
echo "  Starting the SubarnaPasal app..."
echo "  When it says ready, open this in your browser:"
echo "      http://localhost:19951"
echo "  KEEP THIS WINDOW OPEN."
echo "=============================================="
pnpm --filter @workspace/subarnapasal run dev
