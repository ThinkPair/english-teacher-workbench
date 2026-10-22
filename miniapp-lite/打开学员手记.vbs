Set sh = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
base = fs.GetParentFolderName(WScript.ScriptFullName)
sh.Run "python.exe """ & base & "\scripts\open_preview.py""", 0, False
