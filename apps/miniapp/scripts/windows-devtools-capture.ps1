[CmdletBinding()]
param(
  [string]$OutputPath,
  [long]$WindowHandle = 0,
  [switch]$Discover
)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$originalForeground = [IntPtr]::Zero
$targetHandle = [IntPtr]::Zero
$captureBitmap = $null
$captureGraphics = $null
$verificationImage = $null
$topMostApplied = $false
$result = $null
$listenerDiagnostics = @()
$visibleWindowDiagnostics = @()
$candidateDiagnostics = @()

function Throw-CaptureError {
  param(
    [Parameter(Mandatory = $true)][string]$Code,
    [Parameter(Mandatory = $true)][string]$Message
  )

  $error = New-Object System.Exception($Message)
  $error.Data['CaptureCode'] = $Code
  throw $error
}

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public sealed class D1dWindowCandidate
{
    public long Handle { get; private set; }
    public int ProcessId { get; private set; }
    public string ProcessName { get; private set; }
    public string ProcessPath { get; private set; }
    public string Title { get; private set; }

    public D1dWindowCandidate(IntPtr handle, int processId, string processName, string processPath, string title)
    {
        Handle = handle.ToInt64();
        ProcessId = processId;
        ProcessName = processName;
        ProcessPath = processPath;
        Title = title;
    }
}

public sealed class D1dWindowFilterResult
{
    public bool IsCandidate { get; private set; }
    public string RejectionReason { get; private set; }

    public D1dWindowFilterResult(bool isCandidate, string rejectionReason)
    {
        IsCandidate = isCandidate;
        RejectionReason = rejectionReason;
    }
}

public sealed class D1dWindowInspection
{
    public long Handle { get; private set; }
    public int ProcessId { get; private set; }
    public string ProcessName { get; private set; }
    public string ProcessPath { get; private set; }
    public string Title { get; private set; }
    public bool Candidate { get; private set; }
    public string RejectionReason { get; private set; }

    public D1dWindowInspection(
        IntPtr handle,
        int processId,
        string processName,
        string processPath,
        string title,
        D1dWindowFilterResult filter)
    {
        Handle = handle.ToInt64();
        ProcessId = processId;
        ProcessName = processName;
        ProcessPath = processPath;
        Title = title;
        Candidate = filter.IsCandidate;
        RejectionReason = filter.RejectionReason;
    }
}

public sealed class D1dRect
{
    public int Left { get; private set; }
    public int Top { get; private set; }
    public int Right { get; private set; }
    public int Bottom { get; private set; }
    public int Width { get { return Right - Left; } }
    public int Height { get { return Bottom - Top; } }

    public D1dRect(int left, int top, int right, int bottom)
    {
        Left = left;
        Top = top;
        Right = right;
        Bottom = bottom;
    }
}

public static class D1dWindowCapture
{
    private const int SwRestore = 9;
    private const int SwMaximize = 3;
    private const uint SwpNoSize = 0x0001;
    private const uint SwpNoMove = 0x0002;
    private const uint SwpNoActivate = 0x0010;
    private const uint GwOwner = 4;
    private const int GwlExStyle = -20;
    private const long WsExToolWindow = 0x00000080L;
    private const int DwmwaCloaked = 14;
    private static readonly IntPtr HwndTopmost = new IntPtr(-1);
    private static readonly IntPtr HwndNotTopmost = new IntPtr(-2);

    [return: MarshalAs(UnmanagedType.Bool)]
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll", EntryPoint = "EnumWindows", ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll", EntryPoint = "IsWindowVisible", ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", EntryPoint = "IsWindow", ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll", EntryPoint = "GetWindow", ExactSpelling = true)]
    private static extern IntPtr GetWindow(IntPtr hWnd, uint command);

    [DllImport("user32.dll", EntryPoint = "GetParent", ExactSpelling = true)]
    private static extern IntPtr GetParent(IntPtr hWnd);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW", ExactSpelling = true, SetLastError = true)]
    private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int index);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW", ExactSpelling = true, SetLastError = true)]
    private static extern int GetWindowLong32(IntPtr hWnd, int index);

    [DllImport("user32.dll", EntryPoint = "GetWindowThreadProcessId", ExactSpelling = true)]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll", EntryPoint = "GetWindowTextW", ExactSpelling = true, CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);

    [DllImport("user32.dll", EntryPoint = "GetWindowRect", ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr hWnd, out NativeRect rect);

    [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute", ExactSpelling = true)]
    private static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out int value, int valueSize);

    [DllImport("dwmapi.dll", EntryPoint = "DwmFlush", ExactSpelling = true)]
    private static extern int DwmFlush();

    [DllImport("user32.dll", EntryPoint = "GetForegroundWindow", ExactSpelling = true)]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", EntryPoint = "ShowWindow", ExactSpelling = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindow(IntPtr hWnd, int command);

    [DllImport("user32.dll", EntryPoint = "SetWindowPos", ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowPos(
        IntPtr hWnd,
        IntPtr hWndInsertAfter,
        int x,
        int y,
        int cx,
        int cy,
        uint flags);

    [DllImport("user32.dll", EntryPoint = "BringWindowToTop", ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll", EntryPoint = "SetForegroundWindow", ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll", EntryPoint = "SetProcessDPIAware", ExactSpelling = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetProcessDPIAware();

    [DllImport("user32.dll", EntryPoint = "SetProcessDpiAwarenessContext", ExactSpelling = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr context);

    public static string NormalizePath(string path)
    {
        if (String.IsNullOrWhiteSpace(path)) return String.Empty;
        var full = Path.GetFullPath(path.Trim());
        var root = Path.GetPathRoot(full);
        if (!String.Equals(full, root, StringComparison.OrdinalIgnoreCase))
        {
            full = full.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        }
        return full;
    }

    public static bool PathsEqual(string left, string right)
    {
        return StringComparer.OrdinalIgnoreCase.Equals(NormalizePath(left), NormalizePath(right));
    }

    public static bool ExecutableDirectoryMatches(string processPath, string[] installDirectories)
    {
        if (String.IsNullOrWhiteSpace(processPath) || installDirectories == null) return false;
        var executableDirectory = Path.GetDirectoryName(NormalizePath(processPath));
        foreach (var directory in installDirectories)
        {
            if (PathsEqual(executableDirectory, directory)) return true;
        }
        return false;
    }

    public static string EnableDpiAwareness()
    {
        try
        {
            if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return "per_monitor_v2";
        }
        catch (EntryPointNotFoundException)
        {
            // Fall through to the legacy process-wide API on older Windows.
        }

        if (SetProcessDPIAware()) return "system";
        throw new InvalidOperationException("could not enable process DPI awareness");
    }

    public static IntPtr GetForeground()
    {
        return GetForegroundWindow();
    }

    public static bool IsUsableVisibleWindow(IntPtr hWnd)
    {
        NativeRect rect;
        return IsWindow(hWnd)
            && IsWindowVisible(hWnd)
            && GetWindowRect(hWnd, out rect)
            && rect.Right > rect.Left
            && rect.Bottom > rect.Top;
    }

    public static bool RestoreAndMaximize(IntPtr hWnd)
    {
        if (!IsWindow(hWnd)) return false;
        if (IsIconic(hWnd)) ShowWindow(hWnd, SwRestore);
        ShowWindow(hWnd, SwMaximize);
        return !IsIconic(hWnd);
    }

    public static bool SetTopMost(IntPtr hWnd)
    {
        if (!IsWindow(hWnd) || !IsWindowVisible(hWnd)) return false;
        return SetWindowPos(
            hWnd,
            HwndTopmost,
            0,
            0,
            0,
            0,
            SwpNoSize | SwpNoMove | SwpNoActivate);
    }

    public static bool RestoreTopMost(IntPtr hWnd)
    {
        if (hWnd == IntPtr.Zero) return true;
        return SetWindowPos(
            hWnd,
            HwndNotTopmost,
            0,
            0,
            0,
            0,
            SwpNoSize | SwpNoMove | SwpNoActivate);
    }

    public static void FlushComposition()
    {
        DwmFlush();
    }

    public static bool RestoreForeground(IntPtr hWnd)
    {
        if (hWnd == IntPtr.Zero) return true;
        if (!IsWindow(hWnd)) return false;
        BringWindowToTop(hWnd);
        SetForegroundWindow(hWnd);
        return GetForegroundWindow() == hWnd;
    }

    public static D1dWindowFilterResult EvaluateWindow(
        string processPath,
        string[] installDirectories,
        string title,
        bool visible,
        bool topLevel,
        bool ownerZero,
        bool notToolWindow,
        bool notCloaked,
        bool rectValid)
    {
        if (!visible) return new D1dWindowFilterResult(false, "window-hidden");
        if (!topLevel) return new D1dWindowFilterResult(false, "child-window");
        if (!ownerZero) return new D1dWindowFilterResult(false, "owned-window");
        if (!notToolWindow) return new D1dWindowFilterResult(false, "tool-window");
        if (!notCloaked) return new D1dWindowFilterResult(false, "cloaked-window");
        if (!rectValid) return new D1dWindowFilterResult(false, "invalid-window-rect");
        if (!ExecutableDirectoryMatches(processPath, installDirectories))
        {
            return new D1dWindowFilterResult(false, "executable-directory-mismatch");
        }
        return new D1dWindowFilterResult(true, null);
    }

    private static bool IsIconic(IntPtr hWnd)
    {
        return IsWindow(hWnd) && IsIconicNative(hWnd);
    }

    [DllImport("user32.dll", EntryPoint = "IsIconic", ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsIconicNative(IntPtr hWnd);

    private static IntPtr GetExtendedStyle(IntPtr hWnd)
    {
        try
        {
            if (IntPtr.Size == 8) return GetWindowLongPtr64(hWnd, GwlExStyle);
            return new IntPtr(GetWindowLong32(hWnd, GwlExStyle));
        }
        catch (EntryPointNotFoundException)
        {
            return new IntPtr(GetWindowLong32(hWnd, GwlExStyle));
        }
    }

    private static bool TryGetCloaked(IntPtr hWnd, out bool cloaked)
    {
        int value;
        var result = DwmGetWindowAttribute(hWnd, DwmwaCloaked, out value, sizeof(int));
        cloaked = value != 0;
        return result == 0;
    }

    private static string ReadTitle(IntPtr hWnd)
    {
        var buffer = new StringBuilder(1024);
        GetWindowText(hWnd, buffer, buffer.Capacity);
        return buffer.ToString();
    }

    public static List<D1dWindowInspection> InspectVisibleTopLevelWindows(string[] installDirectories)
    {
        var windows = new List<D1dWindowInspection>();
        EnumWindows((hWnd, lParam) =>
        {
            if (!IsWindowVisible(hWnd)) return true;

            uint processId;
            GetWindowThreadProcessId(hWnd, out processId);
            var title = ReadTitle(hWnd);
            var processName = String.Empty;
            var processPath = String.Empty;
            try
            {
                using (var process = Process.GetProcessById((int)processId))
                {
                    processName = process.ProcessName + ".exe";
                    try
                    {
                        processPath = process.MainModule == null ? String.Empty : process.MainModule.FileName;
                    }
                    catch (Win32Exception) { processPath = String.Empty; }
                    catch (InvalidOperationException) { processPath = String.Empty; }
                }
            }
            catch (ArgumentException) { }
            catch (InvalidOperationException) { }

            var ownerZero = GetWindow(hWnd, GwOwner) == IntPtr.Zero;
            var topLevel = GetParent(hWnd) == IntPtr.Zero;
            var notToolWindow = (GetExtendedStyle(hWnd).ToInt64() & WsExToolWindow) == 0;
            bool cloaked;
            var cloakedKnown = TryGetCloaked(hWnd, out cloaked);
            var notCloaked = cloakedKnown && !cloaked;
            NativeRect nativeRect;
            var rectValid = GetWindowRect(hWnd, out nativeRect)
                && nativeRect.Right > nativeRect.Left
                && nativeRect.Bottom > nativeRect.Top;
            var filter = EvaluateWindow(
                processPath,
                installDirectories,
                title,
                true,
                topLevel,
                ownerZero,
                notToolWindow,
                notCloaked,
                rectValid);
            windows.Add(new D1dWindowInspection(
                hWnd,
                (int)processId,
                processName,
                processPath,
                title,
                filter));
            return true;
        }, IntPtr.Zero);
        return windows;
    }
}
'@

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

function Resolve-ListenerInstallDirectories {
  $ports = @(52849, 9420)
  $rows = @()
  $directories = New-Object System.Collections.Generic.List[string]

  foreach ($port in $ports) {
    $connections = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
    if ($connections.Count -eq 0) {
      Throw-CaptureError 'DEVTOOLS_LISTENER_NOT_FOUND' "没有发现端口 $port 的监听进程"
    }

    foreach ($connection in $connections) {
      $ownerPid = [int]$connection.OwningProcess
      try {
        $process = [Diagnostics.Process]::GetProcessById($ownerPid)
        try {
          $processPath = $process.MainModule.FileName
          $processName = "$($process.ProcessName).exe"
        }
        finally {
          $process.Dispose()
        }
      }
      catch {
        Throw-CaptureError 'DEVTOOLS_LISTENER_PROCESS_PATH_FAILED' "无法读取端口 $port 的监听进程路径（PID $ownerPid）：$($_.Exception.Message)"
      }

      if ([string]::IsNullOrWhiteSpace($processPath)) {
        Throw-CaptureError 'DEVTOOLS_LISTENER_PROCESS_PATH_FAILED' "端口 $port 的监听进程没有可用路径（PID $ownerPid）"
      }
      $installDirectory = [D1dWindowCapture]::NormalizePath([IO.Path]::GetDirectoryName($processPath))
      if ([string]::IsNullOrWhiteSpace($installDirectory)) {
        Throw-CaptureError 'DEVTOOLS_LISTENER_INSTALL_DIRECTORY_FAILED' "无法从端口 $port 的进程路径解析安装目录"
      }
      if (-not $directories.Contains($installDirectory)) { $directories.Add($installDirectory) }
      $rows += [ordered]@{
        port = $port
        processId = $ownerPid
        process = $processName
        processPath = $processPath
        installDirectory = $installDirectory
      }
    }
  }

  [ordered]@{
    ports = $rows
    installDirectories = @($directories)
  }
}

function Convert-InspectionToDiagnostic {
  param([Parameter(Mandatory = $true)]$Inspection)
  [ordered]@{
    handle = $Inspection.Handle
    title = $Inspection.Title
    process = $Inspection.ProcessName
    processPath = $Inspection.ProcessPath
    processId = $Inspection.ProcessId
    rejectionReason = $Inspection.RejectionReason
  }
}

function Get-UniqueCandidate {
  param(
    [Parameter(Mandatory = $true)][array]$Inspections,
    [Parameter(Mandatory = $true)][object]$Discovery
  )

  $candidates = @($Inspections | Where-Object { $_.Candidate })
  $script:candidateDiagnostics = @($candidates | ForEach-Object { Convert-InspectionToDiagnostic $_ })
  if ($candidates.Count -eq 0) {
    Throw-CaptureError 'DEVTOOLS_WINDOW_NOT_FOUND' "没有找到符合动态安装目录条件的唯一 DevTools 主窗口；候选拒绝原因已输出"
  }
  if ($candidates.Count -ne 1) {
    Throw-CaptureError 'DEVTOOLS_WINDOW_NOT_UNIQUE' "动态安装目录匹配到 $($candidates.Count) 个 DevTools 主窗口；拒绝面积或前台兜底"
  }
  $candidates[0]
}

$originalForeground = [D1dWindowCapture]::GetForeground()

try {
  [D1dWindowCapture]::EnableDpiAwareness() | Out-Null
  $discovery = $null
  $inspections = @()

  if ($WindowHandle -eq 0) {
    $discovery = Resolve-ListenerInstallDirectories
    $listenerDiagnostics = @($discovery.ports)
    $inspections = @([D1dWindowCapture]::InspectVisibleTopLevelWindows([string[]]$discovery.installDirectories))
    $visibleWindowDiagnostics = @($inspections | ForEach-Object { Convert-InspectionToDiagnostic $_ })
    $candidate = Get-UniqueCandidate -Inspections $inspections -Discovery $discovery
    $targetHandle = [IntPtr]::new($candidate.Handle)
  }
  else {
    $targetHandle = [IntPtr]::new($WindowHandle)
    if (-not [D1dWindowCapture]::IsUsableVisibleWindow($targetHandle)) {
      Throw-CaptureError 'DEVTOOLS_WINDOW_INVALID' "指定的 DevTools HWND 不存在、不可见或窗口区域无效：$WindowHandle"
    }
    $candidate = [ordered]@{
      Handle = $WindowHandle
      ProcessId = $null
      ProcessName = $null
      ProcessPath = $null
      Title = $null
    }
  }

  if ($Discover) {
    $result = [ordered]@{
      ok = $true
      mode = 'discover'
      windowHandle = [int64]$candidate.Handle
      processId = $candidate.ProcessId
      processName = $candidate.ProcessName
      processPath = $candidate.ProcessPath
      windowTitle = $candidate.Title
      listenerProcesses = @($listenerDiagnostics)
      installDirectories = @($discovery.installDirectories)
      visibleWindows = @($visibleWindowDiagnostics)
      candidateWindows = @($candidateDiagnostics)
      capturedAt = [DateTime]::UtcNow.ToString('o')
    }
  }
  else {
    if ([string]::IsNullOrWhiteSpace($OutputPath)) {
      Throw-CaptureError 'OUTPUT_PATH_REQUIRED' '截图模式必须提供 OutputPath'
    }
    $OutputPath = [IO.Path]::GetFullPath($OutputPath)
    if (-not [D1dWindowCapture]::IsUsableVisibleWindow($targetHandle)) {
      Throw-CaptureError 'DEVTOOLS_WINDOW_INVALID' '截图前目标 DevTools HWND 不存在、不可见或窗口区域无效'
    }
    if (-not [D1dWindowCapture]::RestoreAndMaximize($targetHandle)) {
      Throw-CaptureError 'DEVTOOLS_WINDOW_MAXIMIZE_FAILED' '目标 DevTools 窗口无法恢复并最大化'
    }
    if (-not [D1dWindowCapture]::SetTopMost($targetHandle)) {
      Throw-CaptureError 'DEVTOOLS_WINDOW_TOPMOST_FAILED' '目标 DevTools 窗口无法临时置顶'
    }
    $topMostApplied = $true
    [D1dWindowCapture]::FlushComposition()

    $primaryBounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    if ($primaryBounds.Width -le 0 -or $primaryBounds.Height -le 0) {
      Throw-CaptureError 'PRIMARY_SCREEN_BOUNDS_INVALID' '主屏幕 bounds 无效'
    }
    $parent = [IO.Path]::GetDirectoryName($OutputPath)
    if ($parent) { [IO.Directory]::CreateDirectory($parent) | Out-Null }
    if (Test-Path -LiteralPath $OutputPath) {
      Throw-CaptureError 'SCREENSHOT_OVERWRITE_REFUSED' "拒绝覆盖已有截图：$OutputPath"
    }

    $captureBitmap = New-Object System.Drawing.Bitmap($primaryBounds.Width, $primaryBounds.Height)
    $captureGraphics = [System.Drawing.Graphics]::FromImage($captureBitmap)
    $captureGraphics.CopyFromScreen(
      $primaryBounds.Left,
      $primaryBounds.Top,
      0,
      0,
      [System.Drawing.Size]::new($primaryBounds.Width, $primaryBounds.Height),
      [System.Drawing.CopyPixelOperation]::SourceCopy
    )
    $captureBitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $captureGraphics.Dispose()
    $captureGraphics = $null
    $captureBitmap.Dispose()
    $captureBitmap = $null

    if (-not (Test-Path -LiteralPath $OutputPath)) {
      Throw-CaptureError 'SCREENSHOT_SAVE_FAILED' '主屏幕截图没有写入磁盘'
    }
    $bytes = (Get-Item -LiteralPath $OutputPath).Length
    if ($bytes -le 0) {
      Throw-CaptureError 'SCREENSHOT_SAVE_FAILED' '主屏幕 PNG 文件为空'
    }
    $verificationImage = [System.Drawing.Image]::FromFile($OutputPath)
    if ($verificationImage.Width -ne $primaryBounds.Width -or $verificationImage.Height -ne $primaryBounds.Height) {
      Throw-CaptureError 'SCREENSHOT_DIMENSIONS_MISMATCH' "PNG 尺寸 $($verificationImage.Width)x$($verificationImage.Height) 不等于主屏幕 bounds $($primaryBounds.Width)x$($primaryBounds.Height)"
    }
    $verificationImage.Dispose()
    $verificationImage = $null

    $result = [ordered]@{
      ok = $true
      mode = 'capture'
      screenshotProvider = 'windows-native-primary-screen'
      windowHandle = [int64]$candidate.Handle
      processId = $candidate.ProcessId
      processName = $candidate.ProcessName
      processPath = $candidate.ProcessPath
      windowTitle = $candidate.Title
      primaryScreenBounds = [ordered]@{ left = $primaryBounds.Left; top = $primaryBounds.Top; right = $primaryBounds.Right; bottom = $primaryBounds.Bottom; width = $primaryBounds.Width; height = $primaryBounds.Height }
      width = $primaryBounds.Width
      height = $primaryBounds.Height
      bytes = [int64]$bytes
      outputPath = $OutputPath
      capturedAt = [DateTime]::UtcNow.ToString('o')
      originalForegroundWindow = $originalForeground.ToInt64()
    }
  }
}
catch {
  $captureCode = $_.Exception.Data['CaptureCode']
  if ([string]::IsNullOrWhiteSpace([string]$captureCode)) { $captureCode = 'WINDOW_CAPTURE_FAILED' }
  $result = [ordered]@{
    ok = $false
    errorCode = [string]$captureCode
    errorMessage = [string]$_.Exception.Message
    originalForegroundWindow = $originalForeground.ToInt64()
    targetWindowHandle = $targetHandle.ToInt64()
    listenerProcesses = @($listenerDiagnostics)
    visibleWindows = @($visibleWindowDiagnostics)
    candidateWindows = @($candidateDiagnostics)
  }
}
finally {
  if ($null -ne $verificationImage) { $verificationImage.Dispose() }
  if ($null -ne $captureGraphics) { $captureGraphics.Dispose() }
  if ($null -ne $captureBitmap) { $captureBitmap.Dispose() }

  if ($null -eq $result) {
    $result = [ordered]@{ ok = $false; errorCode = 'WINDOW_CAPTURE_FAILED'; errorMessage = '截图结束时没有结果' }
  }

  $restoredTopMost = $true
  if ($topMostApplied -and $targetHandle -ne [IntPtr]::Zero) {
    try { $restoredTopMost = [D1dWindowCapture]::RestoreTopMost($targetHandle) }
    catch { $restoredTopMost = $false }
  }
  $restored = $false
  try { $restored = [D1dWindowCapture]::RestoreForeground($originalForeground) }
  catch { $restored = $false }
  $result.restoredTopMost = $restoredTopMost
  $result.restoredOriginalForeground = $restored
}

$result | ConvertTo-Json -Depth 10 -Compress
if (-not $result.ok) { exit 1 }
