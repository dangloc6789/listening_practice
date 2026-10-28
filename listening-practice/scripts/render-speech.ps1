param([Parameter(Mandatory=$true)][string]$JobPath)
$ErrorActionPreference = 'Stop'
$job = Get-Content -LiteralPath $JobPath -Raw -Encoding UTF8 | ConvertFrom-Json
$voice = New-Object -ComObject SAPI.SpVoice
$voice.Rate = 0
$voice.Volume = 100
$tokens = @{}
foreach ($token in $voice.GetVoices()) { $tokens[$token.GetDescription()] = $token }
foreach ($segment in $job.segments) {
  if (-not $tokens.ContainsKey($segment.voice)) { throw "Required installed voice missing: $($segment.voice)" }
  $stream = New-Object -ComObject SAPI.SpFileStream
  try {
    $stream.Format.Type = 22 # PCM 22050 Hz, 16 bit, mono
    $stream.Open([string]$segment.path, 3, $false)
    $voice.Voice = $tokens[$segment.voice]
    $voice.AllowAudioOutputFormatChangesOnNextSet = $false
    $voice.AudioOutputStream = $stream
    [void]$voice.Speak([string]$segment.text, 0)
  } finally {
    $stream.Close()
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($stream)
  }
}
[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($voice)
