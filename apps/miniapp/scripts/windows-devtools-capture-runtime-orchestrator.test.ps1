param(
  [Parameter(Mandatory = $true)][string]$HelperPath,
  [Parameter(Mandatory = $true)][string]$EvidenceDir,
  [Parameter(Mandatory = $true)][string]$ResultPath
)

$ErrorActionPreference = 'Stop'
[IO.Directory]::CreateDirectory($EvidenceDir) | Out-Null
$runtimeLogPath = Join-Path $EvidenceDir 'runtime-self-test.log'

function Write-RuntimeStep {
  param([Parameter(Mandatory = $true)][string]$Step)
  [IO.File]::AppendAllText(
    $runtimeLogPath,
    ('{0:o} {1}' -f [DateTime]::UtcNow, $Step) + [Environment]::NewLine,
    (New-Object System.Text.UTF8Encoding($false))
  )
}

trap {
  try {
    Write-RuntimeStep ('fatal-before-result: ' + [string]$_.Exception.Message)
    $fatalResult = [ordered]@{
      ok = $false
      processId = $PID
      error = [string]$_.Exception.Message
      windowClosed = $false
    }
    [IO.File]::WriteAllText(
      $ResultPath,
      ($fatalResult | ConvertTo-Json -Depth 10),
      (New-Object System.Text.UTF8Encoding($false))
    )
  }
  catch { }
  exit 1
}

Write-RuntimeStep 'preamble-start'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Write-RuntimeStep 'assemblies-loaded'

Add-Type -ReferencedAssemblies @('System.Drawing', 'System.Windows.Forms') -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

public sealed class D1dRuntimePngInspection
{
    public int Width { get; set; }
    public int Height { get; set; }
    public long OpaquePixels { get; set; }
    public bool HasMultipleColors { get; set; }
}

public sealed class D1dRuntimeWindowHost : IDisposable
{
    private readonly ManualResetEvent ready = new ManualResetEvent(false);
    private Thread thread;
    private Form form;
    private Exception failure;

    public long Handle { get; private set; }
    public Rectangle InitialBounds { get; private set; }
    public bool Closed { get; private set; }

    public void Start()
    {
        thread = new Thread(Run);
        thread.SetApartmentState(ApartmentState.STA);
        thread.IsBackground = true;
        thread.Start();
        if (!ready.WaitOne(TimeSpan.FromSeconds(15)))
        {
            throw new TimeoutException("WinForms runtime window did not become ready");
        }
        if (failure != null)
        {
            throw new InvalidOperationException("WinForms runtime window failed", failure);
        }
        if (Handle == 0)
        {
            throw new InvalidOperationException("WinForms runtime window did not publish an HWND");
        }
    }

    private void Run()
    {
        try
        {
            Application.EnableVisualStyles();
            form = new Form();
            form.Text = "D1D_CAPTURE_RUNTIME_TEST";
            form.StartPosition = FormStartPosition.CenterScreen;
            form.Size = new Size(920, 620);
            form.BackColor = Color.FromArgb(24, 73, 118);

            var label = new Label();
            label.Dock = DockStyle.Fill;
            label.Text = "D1D CAPTURE RUNTIME TEST\r\nVISIBLE WINFORMS WINDOW";
            label.TextAlign = ContentAlignment.MiddleCenter;
            label.ForeColor = Color.White;
            label.BackColor = Color.FromArgb(24, 73, 118);
            label.Font = new Font("Segoe UI", 30, FontStyle.Bold);
            form.Controls.Add(label);
            form.Shown += delegate
            {
                Handle = form.Handle.ToInt64();
                InitialBounds = form.Bounds;
                ready.Set();
            };
            form.FormClosed += delegate { Closed = true; };
            Application.Run(form);
        }
        catch (Exception exception)
        {
            failure = exception;
            ready.Set();
        }
        finally
        {
            if (form != null) form.Dispose();
        }
    }

    public void Stop()
    {
        if (form != null && !form.IsDisposed)
        {
            try
            {
                form.BeginInvoke(new Action(delegate { form.Close(); }));
            }
            catch (InvalidOperationException) { }
        }
        if (thread != null) thread.Join(TimeSpan.FromSeconds(10));
    }

    public void Dispose()
    {
        Stop();
        ready.Dispose();
    }

    public static D1dRuntimePngInspection InspectPng(string path)
    {
        using (var source = new Bitmap(path))
        using (var bitmap = new Bitmap(source.Width, source.Height, PixelFormat.Format32bppArgb))
        {
            using (var graphics = Graphics.FromImage(bitmap))
            {
                graphics.DrawImageUnscaled(source, 0, 0);
            }
            var rect = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
            var data = bitmap.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            try
            {
                var length = Math.Abs(data.Stride) * data.Height;
                var pixels = new byte[length];
                Marshal.Copy(data.Scan0, pixels, 0, length);
                long opaquePixels = 0;
                var firstColor = -1;
                var multipleColors = false;
                for (var offset = 0; offset + 3 < pixels.Length; offset += 4)
                {
                    var alpha = pixels[offset + 3];
                    if (alpha == 0) continue;
                    opaquePixels++;
                    var color = pixels[offset] | (pixels[offset + 1] << 8) | (pixels[offset + 2] << 16);
                    if (firstColor < 0) firstColor = color;
                    else if (color != firstColor) multipleColors = true;
                }
                return new D1dRuntimePngInspection
                {
                    Width = bitmap.Width,
                    Height = bitmap.Height,
                    OpaquePixels = opaquePixels,
                    HasMultipleColors = multipleColors
                };
            }
            finally
            {
                bitmap.UnlockBits(data);
            }
        }
    }
}

public static class D1dRuntimeDesktop
{
    private const int UoiName = 2;

    [DllImport("kernel32.dll", EntryPoint = "GetCurrentThreadId", ExactSpelling = true)]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll", EntryPoint = "GetThreadDesktop", ExactSpelling = true)]
    private static extern IntPtr GetThreadDesktop(uint threadId);

    [DllImport("user32.dll", EntryPoint = "GetUserObjectInformationW", ExactSpelling = true, CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetUserObjectInformation(
        IntPtr handle,
        int index,
        StringBuilder information,
        int length,
        out int needed);

    public static string CurrentDesktopName()
    {
        var desktop = GetThreadDesktop(GetCurrentThreadId());
        var needed = 0;
        GetUserObjectInformation(desktop, UoiName, null, 0, out needed);
        var buffer = new StringBuilder(Math.Max(needed / 2, 256));
        if (!GetUserObjectInformation(desktop, UoiName, buffer, buffer.Capacity * 2, out needed))
        {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
        return buffer.ToString();
    }
}
'@
Write-RuntimeStep 'runtime-types-compiled'

function Find-LastJson {
  param([Parameter(Mandatory = $true)][string[]]$Lines)
  for ($index = $Lines.Count - 1; $index -ge 0; $index--) {
    try { return $Lines[$index] | ConvertFrom-Json } catch { }
  }
  $null
}

$runtimeResult = $null
$windowHost = $null
$exitCode = 1

try {
  Write-RuntimeStep 'runtime-try-start'
  [IO.Directory]::CreateDirectory($EvidenceDir) | Out-Null
  $pngPath = Join-Path $EvidenceDir 'runtime-primary-screen.png'
  if (Test-Path -LiteralPath $pngPath) { throw "runtime PNG already exists: $pngPath" }

  $desktopName = [D1dRuntimeDesktop]::CurrentDesktopName()
  Write-RuntimeStep ('desktop=' + $desktopName)
  $windowHost = New-Object D1dRuntimeWindowHost
  Write-RuntimeStep 'window-host-created'
  $windowHost.Start()
  Write-RuntimeStep ('window-ready hwnd=' + $windowHost.Handle)

  Write-RuntimeStep 'helper-start'
  $helperOutput = @(& powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $HelperPath -OutputPath $pngPath -WindowHandle ([string]$windowHost.Handle) 2>&1 | ForEach-Object { [string]$_ })
  $helperExitCode = $LASTEXITCODE
  Write-RuntimeStep ('helper-exit=' + $helperExitCode)
  $capture = Find-LastJson -Lines $helperOutput
  if ($null -eq $capture) { throw "production helper returned no JSON (exit $helperExitCode)" }
  if ($helperExitCode -ne 0 -or $capture.ok -ne $true) {
    throw "production helper failed [$($capture.errorCode)] $($capture.errorMessage)"
  }
  if (-not (Test-Path -LiteralPath $pngPath)) { throw 'runtime PNG was not written' }

  $file = Get-Item -LiteralPath $pngPath
  if ($file.Length -le 0) { throw 'runtime PNG is empty' }
  $png = [D1dRuntimeWindowHost]::InspectPng($pngPath)
  Write-RuntimeStep 'png-inspected'
  if ($png.Width -ne [int]$capture.width -or $png.Height -ne [int]$capture.height) {
    throw "runtime PNG dimensions $($png.Width)x$($png.Height) do not match helper $($capture.width)x$($capture.height)"
  }
  if ($png.OpaquePixels -le 0) { throw 'runtime PNG is fully transparent' }
  if (-not $png.HasMultipleColors) { throw 'runtime PNG has no rendered visual variation' }

  $runtimeResult = [ordered]@{
    ok = $true
    desktopName = $desktopName
    processId = $PID
    title = 'D1D_CAPTURE_RUNTIME_TEST'
    hwnd = $windowHost.Handle
    initialWindowBounds = [ordered]@{
      left = $windowHost.InitialBounds.Left
      top = $windowHost.InitialBounds.Top
      width = $windowHost.InitialBounds.Width
      height = $windowHost.InitialBounds.Height
    }
    primaryScreenBounds = $capture.primaryScreenBounds
    pngPath = $pngPath
    bytes = [int64]$file.Length
    width = $png.Width
    height = $png.Height
    opaquePixels = $png.OpaquePixels
    hasMultipleColors = $png.HasMultipleColors
    screenshotProvider = $capture.screenshotProvider
    restoredTopMost = $capture.restoredTopMost
    restoredOriginalForeground = $capture.restoredOriginalForeground
    capturedAt = $capture.capturedAt
  }
  $exitCode = 0
}
catch {
  Write-RuntimeStep ('runtime-catch: ' + [string]$_.Exception.Message)
  $runtimeResult = [ordered]@{
    ok = $false
    processId = $PID
    error = [string]$_.Exception.Message
  }
}
finally {
  Write-RuntimeStep 'runtime-finally-start'
  if ($null -ne $windowHost) {
    try { $windowHost.Stop() } catch { }
    $runtimeResult.windowClosed = [bool]$windowHost.Closed
    $windowHost.Dispose()
  }
  else {
    $runtimeResult.windowClosed = $true
  }
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($ResultPath)) | Out-Null
  [IO.File]::WriteAllText(
    $ResultPath,
    ($runtimeResult | ConvertTo-Json -Depth 10),
    (New-Object System.Text.UTF8Encoding($false))
  )
  Write-RuntimeStep ('result-written ok=' + $runtimeResult.ok)
}

exit $exitCode
