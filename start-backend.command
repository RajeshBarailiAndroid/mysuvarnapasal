#!/bin/bash
# SubarnaPasal — start the Laravel backend (double-click me)
cd "$(dirname "$0")/laravel-backend" || exit 1

echo "=============================================="
echo "  SubarnaPasal backend starting..."
echo "=============================================="

# 1) Make sure Homebrew is available
if ! command -v brew >/dev/null 2>&1; then
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  else
    echo ""
    echo "Homebrew is not installed yet. Installing it first (you may be asked for your Mac password)..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || exit 1
    eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"
  fi
fi

# 2) Make sure PHP and Composer are installed
command -v php >/dev/null 2>&1 || { echo "Installing PHP (one-time, a few minutes)..."; brew install php || exit 1; }
command -v composer >/dev/null 2>&1 || { echo "Installing Composer (one-time)..."; brew install composer || exit 1; }

# 3) One-time project setup
if [ ! -d vendor ]; then
  echo "Installing project packages (one-time, a few minutes)..."
  composer install --no-interaction || exit 1
fi
if [ ! -f .env ]; then
  cp .env.example .env
  # Use the zero-setup SQLite database
  sed -i '' 's/^DB_CONNECTION=mysql/DB_CONNECTION=sqlite/' .env
  sed -i '' 's/^DB_HOST=/#DB_HOST=/' .env
  sed -i '' 's/^DB_PORT=/#DB_PORT=/' .env
  sed -i '' 's/^DB_DATABASE=subarnapasal/#DB_DATABASE=subarnapasal/' .env
  sed -i '' 's/^DB_USERNAME=/#DB_USERNAME=/' .env
  sed -i '' 's/^DB_PASSWORD=/#DB_PASSWORD=/' .env
  php artisan key:generate --force
fi
[ -f database/database.sqlite ] || touch database/database.sqlite
php artisan migrate --force || exit 1

# Free port 8080 if an old server (e.g. the Node backend) is still holding it
OLD_PIDS=$(lsof -ti tcp:8080 2>/dev/null)
if [ -n "$OLD_PIDS" ]; then
  echo "Stopping old server on port 8080..."
  kill -9 $OLD_PIDS 2>/dev/null
  sleep 1
fi

echo ""
echo "=============================================="
echo "  Backend is running on port 8080."
echo "  KEEP THIS WINDOW OPEN."
echo "  Now double-click start-frontend.command"
echo "=============================================="
php artisan serve --port=8080
