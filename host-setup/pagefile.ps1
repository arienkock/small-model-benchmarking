# Switch C:\pagefile.sys from system-managed (capped at ~1/8 of the volume, 14.8 GB here)
# to 16-24 GB, so llama-server (~20 GB committed) plus Docker stop exhausting the commit limit.
$cs = Get-CimInstance Win32_ComputerSystem
Set-CimInstance -InputObject $cs -Property @{ AutomaticManagedPagefile = $false }
$pf = Get-CimInstance Win32_PageFileSetting | Where-Object { $_.Name -ieq 'C:\pagefile.sys' }
if ($pf) {
  Set-CimInstance -InputObject $pf -Property @{ InitialSize = [uint32]16384; MaximumSize = [uint32]24576 }
} else {
  New-CimInstance -ClassName Win32_PageFileSetting -Property @{ Name = 'C:\pagefile.sys'; InitialSize = [uint32]16384; MaximumSize = [uint32]24576 } | Out-Null
}
Get-CimInstance Win32_ComputerSystem | Select-Object AutomaticManagedPagefile | Format-List
Get-CimInstance Win32_PageFileSetting | Format-List Name, InitialSize, MaximumSize
Get-CimInstance Win32_PageFileUsage | Format-List Name, AllocatedBaseSize, CurrentUsage, PeakUsage
