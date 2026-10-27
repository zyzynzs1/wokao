' Launch wokao without Explorer SmartScreen check.
' It starts cmd.exe (trusted) which then starts wokao.exe directly.
Option Explicit
Dim fso, sh, base
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
base = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = base
sh.Run "cmd /c """"" & base & "\wokao.exe""""", 0, False
