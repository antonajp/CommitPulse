#!/bin/bash
# copy-repo.sh - Copy gitr files to CommitPulse repo with exclusions
# Usage: ./copy-repo.sh

set -e

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="$(dirname "$SOURCE_DIR")/CommitPulse"

echo "Copying from: $SOURCE_DIR"
echo "Copying to:   $TARGET_DIR"

# Create target directory if it doesn't exist
mkdir -p "$TARGET_DIR"

# Use rsync with exclusions
# Security: Exclude all files that could contain secrets or credentials
rsync -av --delete \
    --exclude='.git/' \
    --exclude='node_modules/' \
    --exclude='dist/' \
    --exclude='out/' \
    --exclude='.vscode-test/' \
    --exclude='*.vsix' \
    --exclude='.env' \
    --exclude='.env.local' \
    --exclude='.env.production' \
    --exclude='.env.development' \
    --exclude='.env.staging' \
    --exclude='*.pem' \
    --exclude='*.key' \
    --exclude='credentials*' \
    --exclude='*secret*' \
    --exclude='.aws/' \
    --exclude='aws-config*' \
    --exclude='.mcp.json' \
    --exclude='legacy/' \
    --exclude='.claude/' \
    --exclude='CLAUDE.md' \
    --exclude='copy-repo.sh' \
    --exclude='*.log' \
    --exclude='.DS_Store' \
    --exclude='coverage/' \
    "$SOURCE_DIR/" "$TARGET_DIR/"

echo ""
echo "Copy complete. Files synced to $TARGET_DIR"
echo ""
echo "To commit changes in CommitPulse:"
echo "  cd $TARGET_DIR && git add -A && git commit -m 'Sync from gitr'"
