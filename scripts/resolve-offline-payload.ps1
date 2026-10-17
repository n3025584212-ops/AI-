param(
  [Parameter(Mandatory=$true)][string]$Source,
  [Parameter(Mandatory=$true)][string]$Destination,
  [Parameter(Mandatory=$true)][string]$Result,
  [Parameter(Mandatory=$true)][long]$ExpectedBytes,
  [Parameter(Mandatory=$true)][string]$InstallDirectory,
  [Parameter(Mandatory=$true)][long]$UnpackedBytes
)
$ErrorActionPreference='Stop'
$taskArchive=$null
$taskInput=$null
$taskOutput=$null
$taskCreated=$null
try {
  $taskSource=[IO.Path]::GetFullPath($Source)
  if($taskSource.Length -gt 1000){throw 'The selected path is too long for this installer.'}
  if(![IO.File]::Exists($taskSource)){throw 'The selected offline source does not exist.'}
  $taskExtension=[IO.Path]::GetExtension($taskSource)
  $taskInstallDrive=[IO.DriveInfo]::new([IO.Path]::GetPathRoot([IO.Path]::GetFullPath($InstallDirectory)))
  $taskInstallRequired=$UnpackedBytes + 64MB
  if($taskExtension -ieq '.zip'){
    $taskTempDrive=[IO.DriveInfo]::new([IO.Path]::GetPathRoot([IO.Path]::GetFullPath($Destination)))
    if($taskTempDrive.Name -ieq $taskInstallDrive.Name){$taskInstallRequired += $ExpectedBytes}
    if($ExpectedBytes -gt 4GB -and $taskTempDrive.DriveFormat -eq 'FAT32'){throw 'The temporary drive must support files larger than 4 GB.'}
  }
  if($taskInstallDrive.AvailableFreeSpace -lt $taskInstallRequired){throw 'Insufficient disk space for the offline application; select another installation drive.'}
  if($taskExtension -ieq '.7z'){
    if([IO.FileInfo]::new($taskSource).Length -ne $ExpectedBytes){throw 'The resource size does not match this installer.'}
    $taskPayload=$taskSource
  } elseif($taskExtension -ieq '.zip'){
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $taskArchive=[IO.Compression.ZipFile]::OpenRead($taskSource)
    $taskMatches=@($taskArchive.Entries | Where-Object {
      $_.FullName.Replace('\','/').Split('/')[-1] -ceq 'QCDKR_Competition_Resources.7z'
    })
    if($taskMatches.Count -ne 1){throw 'Select a complete program ZIP with exactly one offline resource package.'}
    $taskEntry=$taskMatches[0]
    if($taskEntry.Length -ne $ExpectedBytes){throw 'The ZIP resource size does not match this installer.'}
    $taskDirectory=[IO.Directory]::CreateDirectory([IO.Path]::GetFullPath($Destination)).FullName
    $taskDrive=[IO.DriveInfo]::new([IO.Path]::GetPathRoot($taskDirectory))
    if($taskDrive.AvailableFreeSpace -lt ($ExpectedBytes + 64MB)){throw 'Insufficient temporary disk space to read the program ZIP.'}
    $taskPayload=[IO.Path]::Combine($taskDirectory,'QCDKR_Competition_Resources.7z')
    # Flatten this one entry; never extract archive paths or execute ZIP contents.
    $taskInput=$taskEntry.Open()
    $taskOutput=[IO.File]::Open($taskPayload,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    $taskCreated=$taskPayload
    $taskInput.CopyTo($taskOutput,1MB)
    $taskOutput.Dispose();$taskOutput=$null
    $taskInput.Dispose();$taskInput=$null
    $taskArchive.Dispose();$taskArchive=$null
    if([IO.FileInfo]::new($taskPayload).Length -ne $ExpectedBytes){throw 'The ZIP resource is incomplete.'}
  } else {
    throw 'Select the offline resource .7z or the complete program .zip.'
  }
  # NSIS reads this UTF-16 file; stdout/OEM code pages must not corrupt Chinese paths.
  [IO.File]::WriteAllText($Result,$taskPayload,[Text.Encoding]::Unicode)
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  if($null -ne $taskOutput){$taskOutput.Dispose();$taskOutput=$null}
  if($null -ne $taskInput){$taskInput.Dispose();$taskInput=$null}
  if($null -ne $taskArchive){$taskArchive.Dispose();$taskArchive=$null}
  if($null -ne $taskCreated -and [IO.File]::Exists($taskCreated)){[IO.File]::Delete($taskCreated)}
  exit 2
} finally {
  if($null -ne $taskOutput){$taskOutput.Dispose()}
  if($null -ne $taskInput){$taskInput.Dispose()}
  if($null -ne $taskArchive){$taskArchive.Dispose()}
}
