Option Explicit
Dim sh, fso, appDir, exe
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = appDir
exe = appDir & "\node_modules\electron\dist\electron.exe"

' Stop running instance (hidden). Note: also stops other apps running as electron.exe
sh.Run "taskkill /IM electron.exe /F", 0, True
WScript.Sleep 800

' Relaunch in background with NO console window
sh.Run """" & exe & """ .", 0, False
