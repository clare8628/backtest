#!/bin/bash
# Fix workerd architecture mismatch on macOS ARM64

cd "$(dirname "$0")"

echo "🔧 Fixing workerd architecture mismatch..."

# Remove incompatible workerd packages
rm -rf node_modules/@cloudflare/workerd-darwin-64 2>/dev/null || true
rm -rf node_modules/@cloudflare/workerd-linux-64 2>/dev/null || true
rm -rf node_modules/@cloudflare/workerd 2>/dev/null || true

# Reinstall correct architecture for Apple Silicon (ARM64)
npm install @cloudflare/workerd-darwin-arm64@latest --save-dev

echo "✅ Fixed! Reinstalling dependencies..."

# Clear npm cache
npm cache clean --force

# Reinstall all deps
npm install

echo "✅ Done! Try 'npm run db:create' again."
