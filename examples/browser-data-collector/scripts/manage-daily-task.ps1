param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Preview", "Install", "Show", "Run", "Uninstall")]
    [string]$Action,

    [string]$TaskName = "ArgSRE-Daily-Operations-Report",

    [string]$ConfigPath,

    [ValidatePattern("^([01]\d|2[0-3]):[0-5]\d$")]
    [string]$Time = "09:00"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$DailyReportScript = Join-Path $ProjectRoot "src\daily-report.js"
$ValidateScript = Join-Path $ProjectRoot "src\validate-config.js"

function Resolve-RequiredPath {
    param([string]$PathValue, [string]$Label)

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        throw "$Label is required for action $Action."
    }
    return (Resolve-Path -LiteralPath $PathValue).Path
}

function Get-TaskDefinition {
    $resolvedConfig = Resolve-RequiredPath $ConfigPath "ConfigPath"
    $node = (Get-Command node -ErrorAction Stop).Source
    $userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $argument = "`"$DailyReportScript`" --config `"$resolvedConfig`""

    return [PSCustomObject]@{
        TaskName = $TaskName
        ConfigPath = $resolvedConfig
        NodePath = $node
        ScriptPath = $DailyReportScript
        WorkingDirectory = $ProjectRoot
        Argument = $argument
        UserId = $userId
        Time = $Time
    }
}

switch ($Action) {
    "Preview" {
        $definition = Get-TaskDefinition
        $definition | Format-List
        Write-Output "LogonType: Interactive (runs only while the user is logged on)"
        Write-Output "No scheduled task was changed."
    }

    "Install" {
        $definition = Get-TaskDefinition

        & $definition.NodePath $ValidateScript --config $definition.ConfigPath
        if ($LASTEXITCODE -ne 0) {
            throw "Configuration validation failed."
        }

        $taskAction = New-ScheduledTaskAction `
            -Execute $definition.NodePath `
            -Argument $definition.Argument `
            -WorkingDirectory $definition.WorkingDirectory
        $trigger = New-ScheduledTaskTrigger `
            -Daily `
            -At ([DateTime]::ParseExact($definition.Time, "HH:mm", $null))
        $principal = New-ScheduledTaskPrincipal `
            -UserId $definition.UserId `
            -LogonType Interactive `
            -RunLevel Limited
        $settings = New-ScheduledTaskSettingsSet `
            -AllowStartIfOnBatteries `
            -DontStopIfGoingOnBatteries `
            -StartWhenAvailable `
            -ExecutionTimeLimit (New-TimeSpan -Hours 2)

        Register-ScheduledTask `
            -TaskName $definition.TaskName `
            -Action $taskAction `
            -Trigger $trigger `
            -Principal $principal `
            -Settings $settings `
            -Description "ArgSRE daily operations report. Requires an interactive user session for browser authentication." `
            -Force | Out-Null

        Write-Output "Installed scheduled task: $($definition.TaskName)"
        Get-ScheduledTask -TaskName $definition.TaskName |
            Select-Object TaskName, State
    }

    "Show" {
        $task = Get-ScheduledTask -TaskName $TaskName
        $info = Get-ScheduledTaskInfo -TaskName $TaskName
        $task | Select-Object TaskName, State
        $info | Select-Object LastRunTime, LastTaskResult, NextRunTime
    }

    "Run" {
        Start-ScheduledTask -TaskName $TaskName
        Write-Output "Started scheduled task: $TaskName"
    }

    "Uninstall" {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Output "Removed scheduled task: $TaskName"
    }
}
