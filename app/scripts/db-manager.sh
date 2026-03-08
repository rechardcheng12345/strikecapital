#!/bin/bash

# ============================================================================
# PostgreSQL Database Manager Script
# Purpose: Backup, restore, and clear database data for staging
# ============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="$PROJECT_ROOT/data_backup"
ENV_FILE="$PROJECT_ROOT/apps/api/.env"

# Add common PostgreSQL paths (Homebrew, Postgres.app, Linux)
export PATH="/opt/homebrew/opt/postgresql@16/bin:/opt/homebrew/opt/postgresql@15/bin:/opt/homebrew/opt/postgresql@14/bin:/opt/homebrew/bin:/Applications/Postgres.app/Contents/Versions/latest/bin:/usr/local/pgsql/bin:$PATH"

# Database tables classification
USER_TABLES="users user_google_accounts participations credit_transactions"
OTHER_TABLES="tasks task_text_options guide_sections user_guide"
ALL_TABLES="$USER_TABLES $OTHER_TABLES"

# ============================================================================
# Helper Functions
# ============================================================================

print_header() {
    echo -e "\n${BLUE}============================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}============================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

# Check for required PostgreSQL tools
check_pg_tools() {
    local need_pgdump="$1"
    local need_psql="$2"

    if [ "$need_pgdump" = true ] && ! command -v pg_dump &> /dev/null; then
        print_error "pg_dump command not found!"
        echo ""
        echo "Please install PostgreSQL client tools:"
        echo "  macOS (Homebrew): brew install postgresql@16"
        echo "  macOS (Postgres.app): Download from https://postgresapp.com"
        echo "  Ubuntu/Debian: sudo apt-get install postgresql-client"
        echo "  RHEL/CentOS: sudo yum install postgresql"
        echo ""
        exit 1
    fi

    if [ "$need_psql" = true ] && ! command -v psql &> /dev/null; then
        print_error "psql command not found!"
        echo ""
        echo "Please install PostgreSQL client tools:"
        echo "  macOS (Homebrew): brew install postgresql@16"
        echo "  macOS (Postgres.app): Download from https://postgresapp.com"
        echo "  Ubuntu/Debian: sudo apt-get install postgresql-client"
        echo "  RHEL/CentOS: sudo yum install postgresql"
        echo ""
        exit 1
    fi
}

# Load environment variables
load_env() {
    # Check for DATABASE_URL first
    if [ -n "$DATABASE_URL" ]; then
        print_info "Using DATABASE_URL from environment"
        return 0
    fi

    # Try to load from .env file
    if [ -f "$ENV_FILE" ]; then
        print_info "Loading environment from $ENV_FILE"
        set -a
        source "$ENV_FILE"
        set +a
        return 0
    fi

    print_error "No database configuration found!"
    echo "Please set DATABASE_URL or create apps/api/.env"
    exit 1
}

# Parse DATABASE_URL or construct connection string
get_db_connection() {
    if [ -n "$DATABASE_URL" ]; then
        echo "$DATABASE_URL"
    else
        local host="${DB_HOST:-localhost}"
        local port="${DB_PORT:-5432}"
        local name="${DB_NAME:-trts}"
        local user="${DB_USER:-postgres}"
        local pass="${DB_PASSWORD:-postgres}"
        echo "postgresql://$user:$pass@$host:$port/$name"
    fi
}

# Parse connection URL to individual components
parse_db_url() {
    local url="$1"
    # Remove protocol
    url="${url#postgresql://}"
    url="${url#postgres://}"

    # Extract user:pass
    local userpass="${url%%@*}"
    url="${url#*@}"

    DB_USER="${userpass%%:*}"
    DB_PASSWORD="${userpass#*:}"

    # Extract host:port
    local hostport="${url%%/*}"
    url="${url#*/}"

    DB_HOST="${hostport%%:*}"
    DB_PORT="${hostport#*:}"

    # Extract database name
    DB_NAME="${url%%\?*}"
}

# Confirm dangerous operation
confirm() {
    local message="$1"
    echo -e "${YELLOW}$message${NC}"
    read -p "Type 'yes' to confirm: " response
    if [ "$response" != "yes" ]; then
        print_warning "Operation cancelled"
        exit 0
    fi
}

# Get backup folder name based on connection (host_dbname)
get_backup_folder() {
    local db_url=$(get_db_connection)
    parse_db_url "$db_url"
    # Replace dots with underscores for IP addresses
    local safe_host="${DB_HOST//./_}"
    echo "${safe_host}_${DB_NAME}"
}

# ============================================================================
# Backup Functions
# ============================================================================

backup_tables() {
    local tables="$1"
    local prefix="$2"
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local filename="backup_${prefix}_${timestamp}.sql"

    # Get folder based on connection
    local folder=$(get_backup_folder)
    local folder_path="$BACKUP_DIR/$folder"
    local filepath="$folder_path/$filename"

    # Create folder if needed
    mkdir -p "$folder_path"

    print_header "Creating Backup: $prefix"

    local db_url=$(get_db_connection)
    parse_db_url "$db_url"

    # Build table list for pg_dump
    local table_args=""
    for table in $tables; do
        table_args="$table_args -t $table"
    done

    print_info "Connection: $DB_HOST/$DB_NAME"
    print_info "Backing up tables: $tables"
    print_info "Output file: $folder/$filename"

    PGPASSWORD="$DB_PASSWORD" pg_dump \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        --data-only \
        --disable-triggers \
        $table_args \
        > "$filepath"

    if [ $? -eq 0 ]; then
        local size=$(du -h "$filepath" | cut -f1)
        print_success "Backup created: $folder/$filename ($size)"
    else
        print_error "Backup failed!"
        rm -f "$filepath"
        exit 1
    fi
}

do_backup() {
    local type="${1:-full}"
    check_pg_tools true false

    case "$type" in
        full)
            backup_tables "$ALL_TABLES" "full"
            ;;
        users)
            backup_tables "$USER_TABLES" "users"
            ;;
        other)
            backup_tables "$OTHER_TABLES" "other"
            ;;
        *)
            print_error "Unknown backup type: $type"
            echo "Usage: $0 backup [full|users|other]"
            exit 1
            ;;
    esac
}

# ============================================================================
# Restore Functions
# ============================================================================

do_restore() {
    local filepath="$1"
    check_pg_tools false true

    if [ -z "$filepath" ]; then
        print_error "Please specify a backup file"
        echo "Usage: $0 restore <backup_file>"
        echo "       $0 restore <folder>/<backup_file>"
        echo ""
        do_list
        exit 1
    fi

    # Check if file exists (handle relative paths)
    if [ ! -f "$filepath" ]; then
        # Try in backup directory (with subfolder path)
        if [ -f "$BACKUP_DIR/$filepath" ]; then
            filepath="$BACKUP_DIR/$filepath"
        else
            # Search in all subfolders
            local found=$(find "$BACKUP_DIR" -name "$(basename "$filepath")" -type f 2>/dev/null | head -1)
            if [ -n "$found" ]; then
                filepath="$found"
            else
                print_error "Backup file not found: $filepath"
                exit 1
            fi
        fi
    fi

    print_header "Restore from Backup"
    print_info "File: $filepath"

    confirm "This will OVERWRITE existing data. Are you sure?"

    local db_url=$(get_db_connection)
    parse_db_url "$db_url"

    print_info "Restoring data..."

    PGPASSWORD="$DB_PASSWORD" psql \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        -f "$filepath"

    if [ $? -eq 0 ]; then
        print_success "Restore completed successfully!"
    else
        print_error "Restore failed!"
        exit 1
    fi
}

# ============================================================================
# Clear Functions
# ============================================================================

clear_table() {
    local table="$1"
    local db_url=$(get_db_connection)
    parse_db_url "$db_url"

    PGPASSWORD="$DB_PASSWORD" psql \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        -c "TRUNCATE TABLE $table CASCADE;" \
        -q
}

clear_users_keep_admin() {
    local db_url=$(get_db_connection)
    parse_db_url "$db_url"

    # Clear transactions first (FK constraint)
    print_info "Clearing credit_transactions..."
    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -q \
        -c "DELETE FROM credit_transactions WHERE user_id NOT IN (SELECT id FROM users WHERE role = 'admin');"

    # Clear participations
    print_info "Clearing participations..."
    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -q \
        -c "DELETE FROM participations WHERE user_id NOT IN (SELECT id FROM users WHERE role = 'admin');"

    # Clear google accounts
    print_info "Clearing user_google_accounts..."
    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -q \
        -c "DELETE FROM user_google_accounts WHERE user_id NOT IN (SELECT id FROM users WHERE role = 'admin');"

    # Clear non-admin users
    print_info "Clearing non-admin users..."
    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -q \
        -c "DELETE FROM users WHERE role != 'admin';"
}

do_clear() {
    local type="$1"
    local keep_admin=false
    check_pg_tools false true

    # Check for --keep-admin flag
    for arg in "$@"; do
        if [ "$arg" == "--keep-admin" ]; then
            keep_admin=true
        fi
    done

    print_header "Clear Database Data"

    case "$type" in
        users)
            if [ "$keep_admin" = true ]; then
                print_warning "Will clear USER data (keeping admin accounts)"
                confirm "This will DELETE all non-admin user data!"
                clear_users_keep_admin
            else
                print_warning "Will clear ALL USER data including admins!"
                confirm "This will DELETE ALL user data including admin accounts!"
                # Clear in FK order
                for table in credit_transactions participations user_google_accounts users; do
                    print_info "Clearing $table..."
                    clear_table "$table"
                done
            fi
            print_success "User data cleared!"
            ;;
        other)
            print_warning "Will clear OTHER data (tasks, guides)"
            confirm "This will DELETE all tasks and guide content!"
            # Clear in FK order
            for table in task_text_options tasks guide_sections user_guide; do
                print_info "Clearing $table..."
                clear_table "$table"
            done
            print_success "Other data cleared!"
            ;;
        all)
            if [ "$keep_admin" = true ]; then
                print_warning "Will clear ALL data (keeping admin accounts)"
                confirm "This will DELETE ALL data except admin accounts!"
                # Clear other data first
                for table in task_text_options tasks guide_sections user_guide; do
                    print_info "Clearing $table..."
                    clear_table "$table"
                done
                # Then clear user data keeping admin
                clear_users_keep_admin
            else
                print_warning "Will clear ALL data from ALL tables!"
                confirm "This will DELETE EVERYTHING! Are you absolutely sure?"
                for table in credit_transactions participations user_google_accounts users task_text_options tasks guide_sections user_guide; do
                    print_info "Clearing $table..."
                    clear_table "$table"
                done
            fi
            print_success "All data cleared!"
            ;;
        *)
            print_error "Unknown clear type: $type"
            echo "Usage: $0 clear [users|other|all] [--keep-admin]"
            exit 1
            ;;
    esac
}

# ============================================================================
# List Backups
# ============================================================================

do_list() {
    print_header "Available Backups"

    if [ ! -d "$BACKUP_DIR" ]; then
        print_warning "Backup directory does not exist"
        exit 0
    fi

    # Find all backup folders and files
    local has_backups=false

    # List backups in subfolders
    for folder in "$BACKUP_DIR"/*/; do
        if [ -d "$folder" ]; then
            local folder_name=$(basename "$folder")
            local sql_files=$(ls -1 "$folder"*.sql 2>/dev/null)

            if [ -n "$sql_files" ]; then
                has_backups=true
                echo -e "${BLUE}[$folder_name]${NC}"
                printf "  %-43s %10s %s\n" "FILENAME" "SIZE" "DATE"
                echo "  --------------------------------------------------------------------"

                for file in "$folder"*.sql; do
                    if [ -f "$file" ]; then
                        local filename=$(basename "$file")
                        local size=$(du -h "$file" | cut -f1)
                        local date=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M" "$file" 2>/dev/null || stat --printf="%y" "$file" 2>/dev/null | cut -d'.' -f1)
                        printf "  %-43s %10s %s\n" "$filename" "$size" "$date"
                    fi
                done
                echo ""
            fi
        fi
    done

    # Also check for any files in root backup dir (legacy)
    local root_files=$(ls -1 "$BACKUP_DIR"/*.sql 2>/dev/null)
    if [ -n "$root_files" ]; then
        has_backups=true
        echo -e "${YELLOW}[legacy - root folder]${NC}"
        printf "  %-43s %10s %s\n" "FILENAME" "SIZE" "DATE"
        echo "  --------------------------------------------------------------------"

        for file in "$BACKUP_DIR"/*.sql; do
            if [ -f "$file" ]; then
                local filename=$(basename "$file")
                local size=$(du -h "$file" | cut -f1)
                local date=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M" "$file" 2>/dev/null || stat --printf="%y" "$file" 2>/dev/null | cut -d'.' -f1)
                printf "  %-43s %10s %s\n" "$filename" "$size" "$date"
            fi
        done
        echo ""
    fi

    if [ "$has_backups" = false ]; then
        print_warning "No backups found in $BACKUP_DIR"
    fi
}

# ============================================================================
# Show Help
# ============================================================================

show_help() {
    echo ""
    echo "PostgreSQL Database Manager"
    echo "============================"
    echo ""
    echo "Usage: $0 <command> [options]"
    echo ""
    echo "Commands:"
    echo "  backup [type]     Create a database backup"
    echo "                    Types: full (default), users, other"
    echo ""
    echo "  restore <file>    Restore from a backup file"
    echo ""
    echo "  clear <type>      Clear database data"
    echo "                    Types: users, other, all"
    echo "                    Options: --keep-admin"
    echo ""
    echo "  list              List available backups"
    echo ""
    echo "Examples:"
    echo "  $0 backup full              # Backup entire database"
    echo "  $0 backup users             # Backup only user data"
    echo "  $0 restore backup_full_xxx.sql"
    echo "  $0 clear users --keep-admin # Clear users but keep admins"
    echo "  $0 clear all                # Clear everything"
    echo ""
    echo "Tables:"
    echo "  User data:  $USER_TABLES"
    echo "  Other data: $OTHER_TABLES"
    echo ""
}

# ============================================================================
# Main
# ============================================================================

main() {
    local command="$1"
    shift || true

    # Create backup directory if needed
    mkdir -p "$BACKUP_DIR"

    # Load environment
    load_env

    case "$command" in
        backup)
            do_backup "$@"
            ;;
        restore)
            do_restore "$@"
            ;;
        clear)
            do_clear "$@"
            ;;
        list)
            do_list
            ;;
        help|--help|-h|"")
            show_help
            ;;
        *)
            print_error "Unknown command: $command"
            show_help
            exit 1
            ;;
    esac
}

main "$@"
