# Dude's eyes: lists where the visible app windows are (positions only) so Dude can walk on top of them,
# and which app is in front so he can stay quiet while you focus. Dude only uses the app name and window
# title if you switch on "Which app you're using" in his Access tab. Nothing leaves your laptop.
param([int]$OwnPid = 0)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class DudeWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int s);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public static string Fg() {
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero) return "";
    uint pid; GetWindowThreadProcessId(h, out pid);
    StringBuilder cn = new StringBuilder(256); GetClassName(h, cn, 256);
    StringBuilder t = new StringBuilder(512); GetWindowText(h, t, 512);
    RECT r; if (DwmGetWindowAttribute(h, 9, out r, 16) != 0) { r.L = 0; r.T = 0; r.R = 0; r.B = 0; }
    return h.ToInt64() + "\t" + pid + "\t" + cn.ToString() + "\t" + r.L + "\t" + r.T + "\t" + r.R + "\t" + r.B + "\t" + t.ToString();
  }
  public static string Scan(uint own) {
    StringBuilder sb = new StringBuilder("[");
    bool first = true;
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h) || IsIconic(h) || GetWindowTextLength(h) == 0) return true;
      uint pid; GetWindowThreadProcessId(h, out pid); if (pid == own) return true;
      if (GetWindow(h, 4) != IntPtr.Zero) return true;
      int ex = GetWindowLong(h, -20); if ((ex & 0x80) != 0) return true;
      int cloaked; if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
      StringBuilder cn = new StringBuilder(256); GetClassName(h, cn, 256); string c = cn.ToString();
      if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd" || c == "Windows.UI.Core.CoreWindow") return true;
      RECT r; if (DwmGetWindowAttribute(h, 9, out r, 16) != 0) return true;
      if (r.R - r.L < 120 || r.B - r.T < 60) return true;
      if (!first) sb.Append(','); first = false;
      sb.Append('[').Append(h.ToInt64()).Append(',').Append(r.L).Append(',').Append(r.T).Append(',').Append(r.R).Append(',').Append(r.B).Append(']');
      return true;
    }, IntPtr.Zero);
    return sb.Append(']').ToString();
  }
}
"@
try { [void][DudeWin]::SetProcessDpiAwarenessContext([IntPtr](-4)) } catch {}
$last = ''
$lastF = ''
$n = 0
while ($true) {
  $s = [DudeWin]::Scan([uint32]$OwnPid)
  if ($s -ne $last) { [Console]::Out.WriteLine($s); [Console]::Out.Flush(); $last = $s }
  $f = [DudeWin]::Fg()
  if ($f -ne $lastF) {
    $lastF = $f
    $p = $f -split "`t", 8
    if ($p.Count -ge 8) {
      $exe = ''
      try { $exe = (Get-Process -Id ([int]$p[1])).ProcessName } catch {}
      $desk = ($p[2] -eq 'Progman' -or $p[2] -eq 'WorkerW' -or $p[2] -eq 'Shell_TrayWnd')
      $o = @{ fg = @{ pid = [int]$p[1]; exe = $exe; title = $p[7]; l = [int]$p[3]; t = [int]$p[4]; r = [int]$p[5]; b = [int]$p[6]; desk = $desk } }
      [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 3)); [Console]::Out.Flush()
    }
  }
  Start-Sleep -Milliseconds 250
  $n++
  if ($OwnPid -gt 0 -and ($n % 20) -eq 0 -and -not (Get-Process -Id $OwnPid -ErrorAction SilentlyContinue)) { break }
}
