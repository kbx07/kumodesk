#!/usr/bin/env bash
# KumoDesk – Proxmox VE LXC installer (run on the Proxmox HOST).
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/kbx07/kumodesk/main/ct/kumodesk.sh)"
#
# Interactive by default (Default or Advanced settings). Every value can also be
# preset with environment variables; ASSUME_YES=1 skips all questions:
#   ASSUME_YES=1 CTID=120 CT_RAM=1024 CT_STORAGE=local-zfs bash -c "$(curl -fsSL .../ct/kumodesk.sh)"
set -euo pipefail

APP="KumoDesk"
REPO="${KUMODESK_REPO:-kbx07/kumodesk}"
BRANCH="${KUMODESK_BRANCH:-main}"
APP_PORT=3003

CT_HOSTNAME="${CT_HOSTNAME:-kumodesk}"
CT_CORES="${CT_CORES:-1}"
CT_RAM="${CT_RAM:-512}"
CT_SWAP="${CT_SWAP:-512}"
CT_DISK="${CT_DISK:-4}"
CT_BRIDGE="${CT_BRIDGE:-vmbr0}"
CT_IP="${CT_IP:-dhcp}"            # dhcp or e.g. 192.168.1.50/24
CT_GW="${CT_GW:-}"                # gateway, static IP only
CT_UNPRIVILEGED="${CT_UNPRIVILEGED:-1}"
CT_PASSWORD="${CT_PASSWORD:-}"    # root password; empty = no password (use: pct exec <id> -- bash)

# ---------- output helpers ----------
YW=$'\e[33m'; BL=$'\e[36m'; RD=$'\e[01;31m'; GN=$'\e[1;92m'; DGN=$'\e[32m'; CL=$'\e[m'; BFR=$'\r\e[K'
CM="${GN}✔${CL}"; CROSS="${RD}✖${CL}"; INFO="${YW}➜${CL}"
SPIN_PID=""
spinner() { local f='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏' i=0; while :; do printf '\r  %s %s' "${YW}${f:i++%${#f}:1}${CL}" "$1"; sleep 0.1; done; }
msg_info() { if [[ -t 1 ]]; then spinner "$1" & SPIN_PID=$!; else echo "  ... $1"; fi; }
stop_spin() { if [[ -n "$SPIN_PID" ]]; then kill "$SPIN_PID" 2>/dev/null || true; wait "$SPIN_PID" 2>/dev/null || true; SPIN_PID=""; fi; }
msg_ok()   { stop_spin; printf '%s  %s %s\n' "$BFR" "$CM" "$1"; }
msg_error() { stop_spin; printf '%s  %s %s\n' "$BFR" "$CROSS" "${RD}$1${CL}" >&2; }
die() { msg_error "$1"; exit 1; }
trap 'stop_spin' EXIT
trap 'msg_error "Failed at line $LINENO: $BASH_COMMAND"' ERR

header() {
  clear 2>/dev/null || true
  cat <<'EOF'
    __ __                      ____            __
   / //_/_  ______ ___  ____  / __ \___  _____/ /__
  / ,< / / / / __ `__ \/ __ \/ / / / _ \/ ___/ //_/
 / /| / /_/ / / / / / / /_/ / /_/ /  __(__  ) ,<
/_/ |_\__,_/_/ /_/ /_/\____/_____/\___/____/_/|_|

EOF
  echo "  Ichimoku D1 decision desk – Proxmox VE LXC installer"
  echo
}

# ---------- checks ----------
[[ $EUID -eq 0 ]] || die "Run this as root on the Proxmox host."
command -v pct >/dev/null && command -v pveam >/dev/null && command -v pvesm >/dev/null \
  || die "This does not look like a Proxmox VE host (pct/pveam/pvesm not found)."
ARCH="$(dpkg --print-architecture)"

pick_storage() { pvesm status -content "$1" 2>/dev/null | awk 'NR>1 && $3=="active" {print $1; exit}'; }
list_storage() { pvesm status -content "$1" 2>/dev/null | awk 'NR>1 && $3=="active" {print $1}'; }
CTID="${CTID:-$(pvesh get /cluster/nextid)}"
CT_STORAGE="${CT_STORAGE:-$(pick_storage rootdir)}"
TPL_STORAGE="${TPL_STORAGE:-$(pick_storage vztmpl)}"

# ---------- dialogs (whiptail), with a plain fallback ----------
INTERACTIVE=0
if [[ -t 0 && "${ASSUME_YES:-0}" != 1 ]]; then INTERACTIVE=1; fi
HAVE_WT=0; command -v whiptail >/dev/null && HAVE_WT=1
BT="$APP LXC installer"
ask() { # ask "Title" "Prompt" "default" -> echoes the answer
  local out
  if [[ $HAVE_WT -eq 1 ]]; then out=$(whiptail --backtitle "$BT" --title "$1" --inputbox "$2" 10 64 "$3" 3>&1 1>&2 2>&3) || exit 1
  else read -r -p "$2 [$3]: " out; out="${out:-$3}"; fi
  echo "$out"
}
ask_pass() {
  local a b
  while :; do
    if [[ $HAVE_WT -eq 1 ]]; then
      a=$(whiptail --backtitle "$BT" --title "Root password" --passwordbox "Root password for the container.\nLeave empty for no password (enter with: pct exec <id> -- bash)." 11 64 3>&1 1>&2 2>&3) || exit 1
      [[ -z "$a" ]] && { echo ""; return; }
      b=$(whiptail --backtitle "$BT" --title "Root password" --passwordbox "Repeat the password." 9 64 3>&1 1>&2 2>&3) || exit 1
    else
      read -r -s -p "Root password (empty = none): " a; echo >&2; [[ -z "$a" ]] && { echo ""; return; }
      read -r -s -p "Repeat: " b; echo >&2
    fi
    if [[ "$a" != "$b" ]]; then [[ $HAVE_WT -eq 1 ]] && whiptail --backtitle "$BT" --msgbox "The passwords do not match." 8 44 || echo "The passwords do not match." >&2; continue; fi
    if [[ ${#a} -lt 5 ]]; then [[ $HAVE_WT -eq 1 ]] && whiptail --backtitle "$BT" --msgbox "Proxmox needs at least 5 characters." 8 48 || echo "At least 5 characters." >&2; continue; fi
    echo "$a"; return
  done
}
choose_storage() { # choose_storage content "Title" current
  local items=() s
  while read -r s; do [[ -n "$s" ]] && items+=("$s" " "); done < <(list_storage "$1")
  if [[ ${#items[@]} -le 2 || $HAVE_WT -eq 0 ]]; then echo "$3"; return; fi
  whiptail --backtitle "$BT" --title "$2" --menu "Choose a storage" 14 60 6 "${items[@]}" 3>&1 1>&2 2>&3 || exit 1
}

advanced_settings() {
  CTID=$(ask "Container ID" "Container ID" "$CTID")
  CT_HOSTNAME=$(ask "Hostname" "Hostname" "$CT_HOSTNAME")
  CT_DISK=$(ask "Disk size" "Disk size in GB" "$CT_DISK")
  CT_CORES=$(ask "CPU" "CPU cores" "$CT_CORES")
  CT_RAM=$(ask "Memory" "RAM in MB" "$CT_RAM")
  CT_BRIDGE=$(ask "Network" "Bridge" "$CT_BRIDGE")
  CT_IP=$(ask "Network" "IPv4 address in CIDR notation, or dhcp" "$CT_IP")
  if [[ "$CT_IP" != dhcp ]]; then CT_GW=$(ask "Network" "Gateway" "$CT_GW"); fi
  CT_STORAGE=$(choose_storage rootdir "Container storage" "$CT_STORAGE")
  TPL_STORAGE=$(choose_storage vztmpl "Template storage" "$TPL_STORAGE")
  if [[ $HAVE_WT -eq 1 ]]; then
    if whiptail --backtitle "$BT" --title "Container type" --yesno "Create an unprivileged container? (recommended)" 8 58; then CT_UNPRIVILEGED=1; else CT_UNPRIVILEGED=0; fi
  fi
  CT_PASSWORD=$(ask_pass)
}

header
if [[ $INTERACTIVE -eq 1 ]]; then
  if [[ $HAVE_WT -eq 1 ]]; then
    whiptail --backtitle "$BT" --title "$APP" --yesno "This will create a new $APP LXC container. Proceed?" 8 58 || { echo "Aborted."; exit 0; }
    MODE=$(whiptail --backtitle "$BT" --title "Settings" --menu "Choose an option" 12 62 2 \
      "1" "Default settings  (${CT_CORES} core, ${CT_RAM} MB, ${CT_DISK} GB, DHCP)" \
      "2" "Advanced settings" 3>&1 1>&2 2>&3) || { echo "Aborted."; exit 0; }
    if [[ "$MODE" == 2 ]]; then advanced_settings; else CT_PASSWORD=$(ask_pass); fi
    header
  else
    read -r -p "Use default settings? [Y/n] " a
    if [[ -n "$a" && ! "$a" =~ ^[YyTt] ]]; then advanced_settings; else CT_PASSWORD=$(ask_pass); fi
  fi
fi

[[ "$CTID" =~ ^[0-9]+$ && "$CTID" -ge 100 ]] || die "Invalid container ID: $CTID"
pct status "$CTID" &>/dev/null && die "Container $CTID already exists."
[[ -n "$CT_STORAGE" ]]  || die "No storage for containers (rootdir) found. Set CT_STORAGE."
[[ -n "$TPL_STORAGE" ]] || die "No storage for templates (vztmpl) found. Set TPL_STORAGE."

row() { printf '  %s%-15s%s %s\n' "$DGN" "$1" "$CL" "${BL}$2${CL}"; }
row "Container ID:" "$CTID"
row "Hostname:" "$CT_HOSTNAME"
row "Resources:" "$CT_CORES core(s), ${CT_RAM} MB RAM, ${CT_DISK} GB disk"
row "Storage:" "$CT_STORAGE (templates: $TPL_STORAGE)"
row "Network:" "$CT_BRIDGE, IP $CT_IP${CT_GW:+, gateway $CT_GW}"
row "Type:" "$([[ "$CT_UNPRIVILEGED" == 1 ]] && echo unprivileged || echo privileged)"
row "Root password:" "$([[ -n "$CT_PASSWORD" ]] && echo set || echo "none (use: pct exec $CTID -- bash)")"
row "Source:" "github.com/$REPO ($BRANCH)"
echo

# ---------- template ----------
msg_info "Updating the template list"
pveam update >/dev/null 2>&1 || true
msg_ok "Template list updated"
# The template must match the host architecture (the list also contains images for other CPUs).
pick_template() { pveam available --section system | awk '{print $2}' | grep -E "^debian-$1-standard_.*_${ARCH}\.tar\." | sort -V | tail -n1 || true; }
TEMPLATE="$(pick_template 13)"
[[ -n "$TEMPLATE" ]] || TEMPLATE="$(pick_template 12)"
[[ -n "$TEMPLATE" ]] || die "No Debian 12/13 template for architecture ${ARCH} in the pveam list."
if ! pveam list "$TPL_STORAGE" | grep -q "$TEMPLATE"; then
  msg_info "Downloading $TEMPLATE"
  pveam download "$TPL_STORAGE" "$TEMPLATE" >/dev/null
  msg_ok "Downloaded $TEMPLATE"
else
  msg_ok "Template $TEMPLATE (${ARCH})"
fi

# ---------- container ----------
NET="name=eth0,bridge=$CT_BRIDGE,ip=$CT_IP"
[[ "$CT_IP" != dhcp && -n "$CT_GW" ]] && NET+=",gw=$CT_GW"
CREATE=(pct create "$CTID" "$TPL_STORAGE:vztmpl/$TEMPLATE"
  --hostname "$CT_HOSTNAME" --cores "$CT_CORES" --memory "$CT_RAM" --swap "$CT_SWAP"
  --rootfs "$CT_STORAGE:$CT_DISK" --net0 "$NET"
  --arch "$ARCH" --unprivileged "$CT_UNPRIVILEGED" --features nesting=1
  --onboot 1 --ostype debian --tags kumodesk
  --description "KumoDesk – Ichimoku D1 decision desk (port $APP_PORT). https://github.com/$REPO")
[[ -n "$CT_PASSWORD" ]] && CREATE+=(--password "$CT_PASSWORD")
msg_info "Creating LXC container $CTID"
"${CREATE[@]}" >/dev/null
msg_ok "Created LXC container $CTID"

msg_info "Starting the container"
if ! pct start "$CTID" 2>/dev/null; then
  pct destroy "$CTID" --purge >/dev/null 2>&1 || true   # do not leave an empty container behind
  die "Container $CTID failed to start and was removed. Details: journalctl -u pve-container@$CTID -n 50"
fi
msg_ok "Started the container"

msg_info "Waiting for the network"
for _ in $(seq 1 30); do
  pct exec "$CTID" -- bash -c 'getent hosts deb.debian.org >/dev/null 2>&1' && break
  sleep 2
done
pct exec "$CTID" -- bash -c 'getent hosts deb.debian.org >/dev/null 2>&1' || die "The container has no network access (DNS)."
msg_ok "Network is up"

msg_info "Installing base packages"
pct exec "$CTID" -- bash -c "apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null"
msg_ok "Installed base packages"

msg_info "Installing $APP (a few minutes)"
LOG="/tmp/kumodesk-install-$CTID.log"
if ! pct exec "$CTID" -- bash -c "curl -fsSL https://raw.githubusercontent.com/$REPO/$BRANCH/install/kumodesk-install.sh | KUMODESK_REPO='$REPO' KUMODESK_BRANCH='$BRANCH' bash" >"$LOG" 2>&1; then
  stop_spin; tail -n 25 "$LOG" >&2
  die "Installation failed. Full log: $LOG (the container $CTID was kept for inspection)"
fi
msg_ok "Installed $APP"

IP="$(pct exec "$CTID" -- hostname -I | awk '{print $1}')"
echo
printf '  %s\n' "${GN}$APP is ready.${CL}"
printf '  %s %s\n' "$INFO" "Open:    ${BL}http://${IP}:${APP_PORT}${CL}  (the first visit creates the administrator account)"
printf '  %s %s\n' "$INFO" "Update:  pct exec $CTID -- update"
printf '  %s %s\n' "$INFO" "Shell:   pct exec $CTID -- bash"
printf '  %s %s\n' "$INFO" "Logs:    pct exec $CTID -- journalctl -u kumodesk -f"
echo
