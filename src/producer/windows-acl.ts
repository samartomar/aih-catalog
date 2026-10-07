import { execFileSync } from "node:child_process";
import { ProducerRefusal, refuse } from "./errors.js";

interface AclSnapshot {
  readonly currentSid: string;
  readonly ownerSid: string;
  readonly rules: readonly {
    readonly sid: string;
    readonly type: "Allow" | "Deny";
    readonly rights: number;
  }[];
}

const POWERSHELL_ACL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
try {
  $request = ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd())
  if ($null -eq $request -or [string]::IsNullOrWhiteSpace([string]$request.path)) { throw 'invalid request' }
  $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  if ($null -eq $currentSid) { throw 'missing current SID' }

  if ($request.provision -eq $true) {
    if ($request.kind -eq 'file') {
      $acl = New-Object System.Security.AccessControl.FileSecurity
    } else {
      $acl = New-Object System.Security.AccessControl.DirectorySecurity
    }
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner($currentSid)
    $trusted = @($currentSid.Value, 'S-1-5-18', 'S-1-5-32-544')
    foreach ($sidText in $trusted) {
      $sid = [System.Security.Principal.SecurityIdentifier]::new($sidText)
      if ($request.kind -eq 'file') {
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
          $sid,
          [System.Security.AccessControl.FileSystemRights]::FullControl,
          [System.Security.AccessControl.AccessControlType]::Allow
        )
      } else {
        $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
          $sid,
          [System.Security.AccessControl.FileSystemRights]::FullControl,
          $inheritance,
          [System.Security.AccessControl.PropagationFlags]::None,
          [System.Security.AccessControl.AccessControlType]::Allow
        )
      }
      [void]$acl.AddAccessRule($rule)
    }
    if ($request.kind -eq 'file') {
      [System.IO.FileInfo]::new([string]$request.path).SetAccessControl($acl)
    } else {
      [System.IO.DirectoryInfo]::new([string]$request.path).SetAccessControl($acl)
    }
  }

  if ($request.kind -eq 'file') {
    $acl = [System.IO.FileInfo]::new([string]$request.path).GetAccessControl()
  } else {
    $acl = [System.IO.DirectoryInfo]::new([string]$request.path).GetAccessControl()
  }
  $descriptor = [System.Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(), 0)
  if ($null -eq $descriptor.DiscretionaryAcl) { throw 'null DACL' }
  $ownerSid = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
  $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object {
    [pscustomobject]@{
      sid = $_.IdentityReference.Value
      type = $_.AccessControlType.ToString()
      rights = [int]$_.FileSystemRights
    }
  })
  $result = [pscustomobject]@{
    currentSid = $currentSid.Value
    ownerSid = $ownerSid
    rules = $rules
  }
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $result -Compress -Depth 4))
} catch {
  [Console]::Error.WriteLine('cache ACL inspection failed')
  exit 31
}
`;

const SYSTEM_SID = "S-1-5-18";
const ADMINISTRATORS_SID = "S-1-5-32-544";
const WRITE_RIGHTS = 0x00000116 | 0x00000040 | 0x00010000 | 0x00040000 | 0x00080000;

function parseSnapshot(value: unknown): AclSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return refuse("cache-unsafe", "Windows cache ACL inspection returned an invalid result");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.currentSid !== "string" ||
    typeof record.ownerSid !== "string" ||
    !Array.isArray(record.rules)
  ) {
    return refuse("cache-unsafe", "Windows cache ACL inspection returned an invalid result");
  }
  const rules = record.rules.map((raw): AclSnapshot["rules"][number] => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return refuse("cache-unsafe", "Windows cache ACL inspection returned an invalid rule");
    }
    const rule = raw as Record<string, unknown>;
    if (
      typeof rule.sid !== "string" ||
      (rule.type !== "Allow" && rule.type !== "Deny") ||
      typeof rule.rights !== "number" ||
      !Number.isSafeInteger(rule.rights)
    ) {
      return refuse("cache-unsafe", "Windows cache ACL inspection returned an invalid rule");
    }
    return { sid: rule.sid, type: rule.type, rights: rule.rights };
  });
  return {
    currentSid: record.currentSid,
    ownerSid: record.ownerSid,
    rules,
  };
}

/**
 * Inspects ACLs through a fixed PowerShell program and JSON stdin. A path is
 * never interpolated into shell source. Provisioning is permitted only for a
 * directory the caller just created; existing paths are inspection-only.
 */
export function assertWindowsCacheAcl(
  path: string,
  provisionNewEntry = false,
  kind: "file" | "directory" = "directory",
): void {
  let snapshot: AclSnapshot;
  try {
    const output = execFileSync(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", POWERSHELL_ACL_SCRIPT],
      {
        input: JSON.stringify({ path, provision: provisionNewEntry, kind }),
        encoding: "utf8",
        windowsHide: true,
        timeout: 8_000,
        maxBuffer: 64 * 1024,
      },
    );
    snapshot = parseSnapshot(JSON.parse(output) as unknown);
  } catch {
    throw new ProducerRefusal(
      "cache-unsafe",
      "Windows cache ownership and permissions could not be verified",
    );
  }

  if (snapshot.currentSid.length === 0 || snapshot.ownerSid !== snapshot.currentSid) {
    throw new ProducerRefusal(
      "cache-unsafe",
      "the Windows cache is not owned by the current user SID",
    );
  }
  const trustedWriters = new Set([snapshot.currentSid, SYSTEM_SID, ADMINISTRATORS_SID]);
  for (const rule of snapshot.rules) {
    if (
      rule.type === "Allow" &&
      (rule.rights & WRITE_RIGHTS) !== 0 &&
      !trustedWriters.has(rule.sid)
    ) {
      throw new ProducerRefusal(
        "cache-unsafe",
        "the Windows cache grants write access to an untrusted SID",
      );
    }
  }
}
