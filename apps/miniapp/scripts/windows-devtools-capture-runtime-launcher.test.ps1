param(
  [Parameter(Mandatory = $true)][string]$DesktopName,
  [Parameter(Mandatory = $true)][string]$OrchestratorPath,
  [Parameter(Mandatory = $true)][string]$HelperPath,
  [Parameter(Mandatory = $true)][string]$EvidenceDir,
  [Parameter(Mandatory = $true)][string]$ResultPath
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class D1dDesktopProcessLauncher
{
    private const uint CreateNoWindow = 0x08000000;
    private const uint DesktopReadObjects = 0x0001;
    private const int UoiName = 2;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int cb;
        public string reserved;
        public string desktop;
        public string title;
        public int x;
        public int y;
        public int xSize;
        public int ySize;
        public int xCountChars;
        public int yCountChars;
        public int fillAttribute;
        public int flags;
        public short showWindow;
        public short reserved2;
        public IntPtr reserved2Pointer;
        public IntPtr standardInput;
        public IntPtr standardOutput;
        public IntPtr standardError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public IntPtr process;
        public IntPtr thread;
        public uint processId;
        public uint threadId;
    }

    [DllImport("kernel32.dll", EntryPoint = "CreateProcessW", ExactSpelling = true, CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateProcess(
        string applicationName,
        StringBuilder commandLine,
        IntPtr processAttributes,
        IntPtr threadAttributes,
        bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref StartupInfo startupInfo,
        out ProcessInformation processInformation);

    [DllImport("kernel32.dll", EntryPoint = "CloseHandle", ExactSpelling = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("user32.dll", EntryPoint = "OpenInputDesktop", ExactSpelling = true, SetLastError = true)]
    private static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint desiredAccess);

    [DllImport("user32.dll", EntryPoint = "GetUserObjectInformationW", ExactSpelling = true, CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetUserObjectInformation(
        IntPtr handle,
        int index,
        StringBuilder information,
        int length,
        out int needed);

    [DllImport("user32.dll", EntryPoint = "CloseDesktop", ExactSpelling = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseDesktop(IntPtr desktop);

    public static string InputDesktopName()
    {
        var desktop = OpenInputDesktop(0, false, DesktopReadObjects);
        if (desktop == IntPtr.Zero)
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenInputDesktop failed");
        }
        try
        {
            int needed;
            GetUserObjectInformation(desktop, UoiName, null, 0, out needed);
            var buffer = new StringBuilder(Math.Max(needed / 2, 256));
            if (!GetUserObjectInformation(desktop, UoiName, buffer, buffer.Capacity * 2, out needed))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "GetUserObjectInformationW failed");
            }
            return "WinSta0\\" + buffer;
        }
        finally
        {
            CloseDesktop(desktop);
        }
    }

    public static int Launch(string applicationPath, string commandLine, string desktopName, string currentDirectory)
    {
        var startupInfo = new StartupInfo();
        startupInfo.cb = Marshal.SizeOf(typeof(StartupInfo));
        startupInfo.desktop = desktopName;
        ProcessInformation processInformation;
        if (!CreateProcess(
            applicationPath,
            new StringBuilder(commandLine),
            IntPtr.Zero,
            IntPtr.Zero,
            false,
            CreateNoWindow,
            IntPtr.Zero,
            currentDirectory,
            ref startupInfo,
            out processInformation))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateProcessW failed");
        }

        try
        {
            return checked((int)processInformation.processId);
        }
        finally
        {
            CloseHandle(processInformation.thread);
            CloseHandle(processInformation.process);
        }
    }
}
'@

function Quote-ProcessArgument {
  param([Parameter(Mandatory = $true)][string]$Value)
  '"' + $Value.Replace('"', '\"') + '"'
}

$powerShellPath = (Get-Command powershell.exe -ErrorAction Stop).Source
$resolvedDesktopName = if ($DesktopName -eq 'INPUT') {
  [D1dDesktopProcessLauncher]::InputDesktopName()
}
else {
  $DesktopName
}
$arguments = @(
  $powerShellPath,
  '-NoLogo',
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  $OrchestratorPath,
  '-HelperPath',
  $HelperPath,
  '-EvidenceDir',
  $EvidenceDir,
  '-ResultPath',
  $ResultPath
)
$commandLine = ($arguments | ForEach-Object { Quote-ProcessArgument ([string]$_) }) -join ' '
$processId = [D1dDesktopProcessLauncher]::Launch(
  $powerShellPath,
  $commandLine,
  $resolvedDesktopName,
  [IO.Path]::GetDirectoryName($OrchestratorPath)
)

[ordered]@{
  ok = $true
  processId = $processId
  desktopName = $resolvedDesktopName
  commandLine = $commandLine
} | ConvertTo-Json -Compress
