# Apply the larger C:\pagefile.sys (16-24 GB) to the running system, as the System
# Properties dialog does for an increase: NtCreatePagingFile on the existing file.
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class PF {
  [StructLayout(LayoutKind.Sequential)]
  public struct UNICODE_STRING { public ushort Length; public ushort MaximumLength; public IntPtr Buffer; }
  [DllImport("ntdll.dll")] public static extern int RtlAdjustPrivilege(int Privilege, bool Enable, bool CurrentThread, out bool Enabled);
  [DllImport("ntdll.dll")] public static extern int NtCreatePagingFile(ref UNICODE_STRING Name, ref long Min, ref long Max, uint Priority);
  public static int Apply(string ntPath, long minBytes, long maxBytes) {
    bool was;
    int p = RtlAdjustPrivilege(15, true, false, out was); // SeCreatePagefilePrivilege
    if (p != 0) return p;
    var us = new UNICODE_STRING();
    us.Buffer = Marshal.StringToHGlobalUni(ntPath);
    us.Length = (ushort)(ntPath.Length * 2);
    us.MaximumLength = (ushort)(us.Length + 2);
    try { return NtCreatePagingFile(ref us, ref minBytes, ref maxBytes, 0); }
    finally { Marshal.FreeHGlobal(us.Buffer); }
  }
}
"@
$status = [PF]::Apply('\??\C:\pagefile.sys', 16384MB, 24576MB)
"NtCreatePagingFile status: 0x{0:X8}" -f $status
