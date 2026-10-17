# Read-only interface notifications. No Windows network configuration commands.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Net.NetworkInformation;
using System.Threading;
using System.Runtime.InteropServices;
public static class DkNicNotification {
  public static readonly AutoResetEvent Changed = new AutoResetEvent(false);
  delegate void IpCallback(IntPtr context, IntPtr row, int kind);
  static IpCallback callback = (context,row,kind) => Changed.Set();
  static IntPtr handle;
  [DllImport("iphlpapi.dll")] static extern uint NotifyIpInterfaceChange(ushort family, IpCallback callback, IntPtr context, bool initial, out IntPtr handle);
  [DllImport("iphlpapi.dll")] static extern uint CancelMibChangeNotify2(IntPtr handle);
  public static void Start() {
    NetworkChange.NetworkAddressChanged += (sender,args) => Changed.Set();
    NetworkChange.NetworkAvailabilityChanged += (sender,args) => Changed.Set();
    NotifyIpInterfaceChange(0, callback, IntPtr.Zero, false, out handle);
  }
  public static void Stop() { if(handle != IntPtr.Zero) CancelMibChangeNotify2(handle); }
}
'@
[DkNicNotification]::Start()
try {
  do {
    $items = @([System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() | ForEach-Object {
      $nic = $_
      $addresses = @($nic.GetIPProperties().UnicastAddresses | Where-Object { $_.Address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork } | ForEach-Object { $_.Address.ToString() })
      [pscustomobject]@{guid=$nic.Id;mac=$nic.GetPhysicalAddress().ToString();name=$nic.Name;kind=$nic.NetworkInterfaceType.ToString();up=($nic.OperationalStatus -eq [System.Net.NetworkInformation.OperationalStatus]::Up);ipv4=$addresses}
    })
    [Console]::WriteLine((ConvertTo-Json -InputObject $items -Compress -Depth 5))
    [void][DkNicNotification]::Changed.WaitOne(5000)
  } while($true)
} finally { [DkNicNotification]::Stop() }
