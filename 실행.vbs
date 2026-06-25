Option Explicit
Dim sh, fso, appDir, exe
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = appDir
exe = appDir & "\node_modules\electron\dist\electron.exe"

' First-run dependency install (window shown only during install)
If Not fso.FileExists(exe) Then
    sh.Run "cmd /c npm install", 1, True
End If

' Launch in background with NO console window (tray icon only)
sh.Run """" & exe & """ .", 0, False
