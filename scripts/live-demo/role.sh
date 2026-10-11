# Source in each demo terminal: `source scripts/live-demo/role.sh owner|second|thief|new`
# Colors the prompt with the role, so the audience sees whose terminal it is, and adds the `sw` command
# (plus `thief` in the thief's terminal). Works in zsh (macOS default) and bash.

if [ -n "${ZSH_VERSION:-}" ]; then
  _sw_here="${(%):-%x}"
else
  _sw_here="${BASH_SOURCE[0]}"
fi
_sw_dir="$(cd "$(dirname "$_sw_here")" && pwd)"
alias sw="$_sw_dir/sw.sh"

SW_ROLE="${1:-owner}"
export SW_ROLE
case "$SW_ROLE" in
  owner | main) _sw_label='OWNER · main key'; _sw_color=32; _sw_zcolor=green ;;
  second) _sw_label='SECOND KEY'; _sw_color=35; _sw_zcolor=magenta ;;
  new) _sw_label='NEW WALLET'; _sw_color=36; _sw_zcolor=cyan ;;
  thief) _sw_label='THIEF · stolen main key'; _sw_color=31; _sw_zcolor=red; alias thief="$_sw_dir/sw.sh thief" ;;
  *) echo "role: owner, second, new or thief"; return 1 2>/dev/null || exit 1 ;;
esac

if [ -n "${ZSH_VERSION:-}" ]; then
  PROMPT="%B%F{$_sw_zcolor}[$_sw_label]%f%b %# "
else
  PS1="\[\033[1;${_sw_color}m\][$_sw_label]\[\033[0m\] \$ "
fi
printf '\033]0;%s\007' "$_sw_label"
printf '\033[1;%sm%s\033[0m  type: sw help\n' "$_sw_color" "$_sw_label"
unset _sw_here _sw_dir _sw_label _sw_color _sw_zcolor
