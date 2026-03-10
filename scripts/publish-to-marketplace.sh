#!/bin/bash
#
# Publish VS Code Extension to Marketplace
#
# This script:
#   1. Bumps the version in package.json
#   2. Updates CHANGELOG.md with changes since last release
#   3. Commits and pushes the changes to private repo (gitr)
#   4. Syncs to public repo (CommitPulse), creates PR (user must approve merge)
#   5. After PR merge, tags the release in public repo
#   6. Builds and publishes to VS Code Marketplace
#
# Usage:
#   ./scripts/publish-to-marketplace.sh [patch|minor|major|<version>]
#
# Examples:
#   ./scripts/publish-to-marketplace.sh patch     # 0.1.2 -> 0.1.3
#   ./scripts/publish-to-marketplace.sh minor     # 0.1.2 -> 0.2.0
#   ./scripts/publish-to-marketplace.sh major     # 0.1.2 -> 1.0.0
#   ./scripts/publish-to-marketplace.sh 1.0.0     # Set explicit version
#
# Prerequisites:
#   - vsce CLI installed (npx @vscode/vsce)
#   - gh CLI installed and authenticated (for creating PRs)
#   - VSCE_PAT environment variable set with Personal Access Token
#   - Clean git working directory (no uncommitted changes)
#   - On main branch
#   - ../CommitPulse directory exists with the public repo
#

set -euo pipefail

# Configuration
PUBLIC_REPO_PATH="../CommitPulse"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

#------------------------------------------------------------------------------
# Helper functions
#------------------------------------------------------------------------------

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

die() {
    log_error "$1"
    exit 1
}

#------------------------------------------------------------------------------
# Pre-flight checks
#------------------------------------------------------------------------------

preflight_checks() {
    log_info "Running pre-flight checks..."

    # Check for gh CLI
    if ! command -v gh &> /dev/null; then
        die "gh CLI not found. Install it from https://cli.github.com"
    fi

    # Check gh CLI is authenticated
    if ! gh auth status &> /dev/null; then
        die "gh CLI not authenticated. Run 'gh auth login' first."
    fi

    # Check for VSCE_PAT
    if [[ -z "${VSCE_PAT:-}" ]]; then
        die "VSCE_PAT environment variable not set. Get a PAT from https://dev.azure.com"
    fi

    # Check we're on main branch
    local current_branch
    current_branch=$(git branch --show-current)
    if [[ "$current_branch" != "main" ]]; then
        die "Must be on main branch to publish. Currently on: $current_branch"
    fi

    # Check for uncommitted changes
    if ! git diff --quiet || ! git diff --staged --quiet; then
        die "Working directory has uncommitted changes. Commit or stash them first."
    fi

    # Check for unpushed commits
    git fetch origin main --quiet
    local local_head remote_head
    local_head=$(git rev-parse HEAD)
    remote_head=$(git rev-parse origin/main)
    if [[ "$local_head" != "$remote_head" ]]; then
        log_warn "Local main differs from origin/main. Pulling latest..."
        git pull origin main --rebase
    fi

    # Check npm dependencies are installed
    if [[ ! -d "node_modules" ]]; then
        log_info "Installing npm dependencies..."
        npm ci
    fi

    # Check public repo exists
    if [[ ! -d "$PUBLIC_REPO_PATH/.git" ]]; then
        die "Public repo not found at $PUBLIC_REPO_PATH. Clone it first."
    fi

    # Check public repo is clean
    if ! (cd "$PUBLIC_REPO_PATH" && git diff --quiet && git diff --staged --quiet); then
        die "Public repo at $PUBLIC_REPO_PATH has uncommitted changes."
    fi

    # Check public repo is on main branch
    local public_branch
    public_branch=$(cd "$PUBLIC_REPO_PATH" && git branch --show-current)
    if [[ "$public_branch" != "main" ]]; then
        die "Public repo must be on main branch. Currently on: $public_branch"
    fi

    log_success "Pre-flight checks passed"
}

#------------------------------------------------------------------------------
# Version handling
#------------------------------------------------------------------------------

get_current_version() {
    node -p "require('./package.json').version"
}

bump_version() {
    local bump_type="$1"
    local current_version
    current_version=$(get_current_version)

    local major minor patch
    IFS='.' read -r major minor patch <<< "$current_version"

    case "$bump_type" in
        patch)
            patch=$((patch + 1))
            ;;
        minor)
            minor=$((minor + 1))
            patch=0
            ;;
        major)
            major=$((major + 1))
            minor=0
            patch=0
            ;;
        *)
            # Assume it's an explicit version
            if [[ "$bump_type" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
                echo "$bump_type"
                return
            else
                die "Invalid version format: $bump_type. Use patch|minor|major or X.Y.Z"
            fi
            ;;
    esac

    echo "${major}.${minor}.${patch}"
}

update_package_version() {
    local new_version="$1"
    log_info "Updating package.json version to $new_version..."

    # Use node to update package.json to preserve formatting
    node -e "
        const fs = require('fs');
        const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        pkg.version = '$new_version';
        fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
    "

    log_success "Updated package.json version"
}

#------------------------------------------------------------------------------
# Changelog handling
#------------------------------------------------------------------------------

get_last_release_tag() {
    # Get the most recent version tag
    git tag --list 'v*' --sort=-version:refname | head -n 1 || echo ""
}

generate_changelog_entry() {
    local new_version="$1"
    local today
    today=$(date +%Y-%m-%d)

    local last_tag
    last_tag=$(get_last_release_tag)

    local commit_range
    if [[ -n "$last_tag" ]]; then
        commit_range="${last_tag}..HEAD"
    else
        # No previous tag, get all commits
        commit_range="HEAD"
    fi

    log_info "Generating changelog from commits since ${last_tag:-'beginning'}..."

    # Categorize commits
    local added="" changed="" fixed="" removed="" technical=""

    while IFS= read -r line; do
        # Skip merge commits and version bump commits
        if [[ "$line" =~ ^Merge|^chore\(release\)|^chore:\ Bump\ version ]]; then
            continue
        fi

        # Parse conventional commit format
        # Pattern: type(scope)?: message or type!: message
        local type message
        local cc_regex='^([a-z]+)(\([^)]+\))?[!]?:[[:space:]]+(.+)$'
        if [[ "$line" =~ $cc_regex ]]; then
            type="${BASH_REMATCH[1]}"
            message="${BASH_REMATCH[3]}"
        else
            # Non-conventional commit, put in changed
            type="other"
            message="$line"
        fi

        # Clean up message - remove PR references, capitalize first letter
        message=$(echo "$message" | sed -E 's/ \(#[0-9]+\)$//' | sed 's/^./\U&/')

        case "$type" in
            feat)
                added="${added}\n- ${message}"
                ;;
            fix)
                fixed="${fixed}\n- ${message}"
                ;;
            docs)
                changed="${changed}\n- ${message}"
                ;;
            refactor|perf|style)
                changed="${changed}\n- ${message}"
                ;;
            test|build|ci|chore)
                # Skip most chore commits, but include important ones
                if [[ "$message" =~ Add|Update|Upgrade ]]; then
                    technical="${technical}\n- ${message}"
                fi
                ;;
            *)
                changed="${changed}\n- ${message}"
                ;;
        esac
    done < <(git log "$commit_range" --pretty=format:"%s" --no-merges 2>/dev/null || true)

    # Build changelog entry
    local entry="## [$new_version] - $today"

    if [[ -n "$added" ]]; then
        entry="${entry}\n\n### Added\n${added}"
    fi

    if [[ -n "$changed" ]]; then
        entry="${entry}\n\n### Changed\n${changed}"
    fi

    if [[ -n "$fixed" ]]; then
        entry="${entry}\n\n### Fixed\n${fixed}"
    fi

    if [[ -n "$removed" ]]; then
        entry="${entry}\n\n### Removed\n${removed}"
    fi

    if [[ -n "$technical" ]]; then
        entry="${entry}\n\n### Technical\n${technical}"
    fi

    echo -e "$entry"
}

update_changelog() {
    local new_version="$1"
    local changelog_file="CHANGELOG.md"

    log_info "Updating CHANGELOG.md..."

    # Generate the new entry
    local new_entry
    new_entry=$(generate_changelog_entry "$new_version")

    # Check if this version already exists in changelog
    if grep -q "## \[$new_version\]" "$changelog_file"; then
        log_warn "Version $new_version already exists in CHANGELOG.md, skipping update"
        return
    fi

    # Insert after the header (line 6, after the format description)
    local header_lines=7
    local header footer

    header=$(head -n "$header_lines" "$changelog_file")
    footer=$(tail -n +"$((header_lines + 1))" "$changelog_file")

    {
        echo "$header"
        echo ""
        echo -e "$new_entry"
        echo ""
        echo "$footer"
    } > "${changelog_file}.tmp"

    mv "${changelog_file}.tmp" "$changelog_file"

    log_success "Updated CHANGELOG.md"
}

#------------------------------------------------------------------------------
# Build and publish
#------------------------------------------------------------------------------

run_quality_checks() {
    log_info "Running quality checks..."

    log_info "  Running linter..."
    npm run lint || die "Linting failed"

    log_info "  Running type checker..."
    npm run typecheck || die "Type checking failed"

    log_info "  Running tests..."
    npm run test:unit || die "Unit tests failed"

    log_success "Quality checks passed"
}

commit_and_push() {
    local new_version="$1"

    log_info "Committing release changes..."

    git add package.json CHANGELOG.md

    git commit -m "$(cat <<EOF
chore(release): Bump version to $new_version

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"

    log_info "Pushing to origin..."
    git push origin main

    log_info "Creating release tag v$new_version..."
    git tag -a "v$new_version" -m "Release v$new_version"
    git push origin "v$new_version"

    log_success "Committed and pushed release"
}

sync_public_repo() {
    local new_version="$1"
    local release_branch="release/v$new_version"

    log_info "Syncing to public repo at $PUBLIC_REPO_PATH..."

    # Files/directories to exclude from public repo
    local exclude_patterns=(
        ".git"
        ".claude"
        ".mcp.json"
        "CLAUDE.md"
        "node_modules"
        "dist"
        "*.vsix"
        ".vscode-test"
        "coverage"
        ".env"
        ".env.*"
        "legacy/config/classified.properties"
        "legacy/config/unclassified.properties"
        "legacy/logs/*"
        "legacy/scripts/import_commits.sh"
        "scripts/publish-to-marketplace.sh"
    )

    # Build rsync exclude arguments
    local rsync_excludes=""
    for pattern in "${exclude_patterns[@]}"; do
        rsync_excludes="$rsync_excludes --exclude=$pattern"
    done

    # Sync files using rsync
    # shellcheck disable=SC2086
    rsync -av --delete \
        $rsync_excludes \
        --exclude="!.env.example" \
        ./ "$PUBLIC_REPO_PATH/"

    log_success "Synced files to public repo"

    # Commit and create PR in public repo
    log_info "Committing changes in public repo..."
    (
        cd "$PUBLIC_REPO_PATH"

        # Check if there are any changes
        if git diff --quiet && git diff --staged --quiet && [[ -z "$(git status --porcelain)" ]]; then
            log_warn "No changes to commit in public repo"
            return 0
        fi

        # Create release branch
        log_info "Creating release branch: $release_branch..."
        git checkout -b "$release_branch"

        git add -A
        git commit -m "$(cat <<EOF
chore(release): Sync with v$new_version

Synced from private repository for marketplace release.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"

        log_info "Pushing release branch to origin..."
        git push -u origin "$release_branch"

        log_info "Creating pull request for public repo..."
        local pr_url
        pr_url=$(gh pr create \
            --title "chore(release): Sync with v$new_version" \
            --body "$(cat <<EOF
## Summary
Synced from private repository for marketplace release v$new_version.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" \
            --base main \
            --head "$release_branch" 2>&1)

        log_success "Created PR: $pr_url"
        echo ""
        echo "╔═══════════════════════════════════════════════════════════════════════════════════╗"
        echo "║                    PUBLIC REPO PR CREATED - ACTION REQUIRED                       ║"
        echo "╠═══════════════════════════════════════════════════════════════════════════════════╣"
        echo "║  Please merge the PR in GitHub, then press Enter to continue:                     ║"
        echo "║  $pr_url"
        echo "╚═══════════════════════════════════════════════════════════════════════════════════╝"
        echo ""
        read -rp "Press Enter after merging the PR..."

        # Switch back to main and pull the merged changes
        log_info "Switching back to main and pulling merged changes..."
        git checkout main
        git pull origin main

        # Delete the local release branch
        git branch -d "$release_branch"

        log_info "Creating release tag v$new_version in public repo..."
        git tag -a "v$new_version" -m "Release v$new_version"
        git push origin "v$new_version"
    )

    log_success "Public repo updated and pushed"
}

build_and_publish() {
    local new_version="$1"

    log_info "Building extension package..."
    npm run package

    log_info "Publishing to VS Code Marketplace..."
    npx @vscode/vsce publish --pat "$VSCE_PAT"

    log_success "Published v$new_version to VS Code Marketplace!"
}

#------------------------------------------------------------------------------
# Main
#------------------------------------------------------------------------------

main() {
    local bump_type="${1:-patch}"

    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║         VS Code Extension Marketplace Publisher                ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    echo ""

    # Run pre-flight checks
    preflight_checks

    # Determine new version
    local current_version new_version
    current_version=$(get_current_version)
    new_version=$(bump_version "$bump_type")

    log_info "Current version: $current_version"
    log_info "New version: $new_version"
    echo ""

    # Confirm with user
    read -rp "Proceed with publishing v$new_version? [y/N] " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        log_warn "Aborted by user"
        exit 0
    fi

    echo ""

    # Update version in package.json
    update_package_version "$new_version"

    # Update changelog
    update_changelog "$new_version"

    # Run quality checks
    run_quality_checks

    # Commit and push to gitr
    commit_and_push "$new_version"

    # Sync to public repo
    sync_public_repo "$new_version"

    # Build and publish
    build_and_publish "$new_version"

    echo ""
    echo "╔═══════════════════════════════════════════════════════════════════════════════════╗"
    echo "║                            🎉 PUBLISH COMPLETE 🎉                                 ║"
    echo "╠═══════════════════════════════════════════════════════════════════════════════════╣"
    echo "║  Version:     v$new_version"
    echo "║  Marketplace: https://marketplace.visualstudio.com/items?itemName=ImproviseLabs.gitr"
    echo "║  Public Repo: https://github.com/antonajp/CommitPulse"
    echo "╚═══════════════════════════════════════════════════════════════════════════════════╝"
    echo ""
}

main "$@"
