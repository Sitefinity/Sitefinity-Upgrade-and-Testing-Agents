Cannot upgrade Sitefinity using the CLI
An error is thrown and the upgrade does not finish successfully when using the CLI tool

Error one:
info Package sources used: http://nuget.sitefinity.com/nuget/,https://nuget.org/api/v2/
fail File "packages.config" not found in project directory "<project directory>". Cannot proceed with upgrade.


Error two:
fail: File "<project directory>\SitefinityWebApp.sln" not found


Error three:
Error occurred while upgrading nuget packages. fail - The path is not of a legal form. Check the C:\temp\netcoreapp3.0\PowerShell\upgrade.log for more details

Error four:
info: Sending HTTP request GET xxxxxxxxxxxxxxx
info: Received HTTP response afer xxxxms - NotFound
info: End processing HTTP request after xxxxxms - NotFound
fail: Object reference not set to an instance of an object.

Error five:
fail: Command "View.PackageManagerConsole" is not available

Error six:
info: Successfully exported upgrade config!
info: Visual studio installation found. Version: "VisualStudio.DTE.17.0". Launching...
fail: The message filter indicated that the application is busy. (0x8001010A (RPC_E_SERVERCALL_RETRYLATER))
info: Closing Visual Studio instance...
info: Closing Visual Studio instance closed.
info: Closing Visual Studio instance...
info: Closing Visual Studio instance closed.

Error seven:
fail: Error occured while upgrading nuget packages. fail -
Error occured while upgrading Telerik.Sitefinity.All. The error was: Unable to resolve dependencies. 'Telerik.Sitefinity.Feather 13.3.7637' is not compatible with 'Progress.Sitefinity 14.3.8000 constraint: Telerik.Sitefinity.Feather (= 14.3.8000)'.Check the C:\sfcli\PowerShell\upgrade.log for more details
fail: Upgrade failed
Defect Number
Enhancement Number
Cause
Errors: one, two, and three:
The project has been created with the Project Manager (and has always been maintained/upgraded through the Project Manager).
The project is not based on NuGet packages.
The project was never built.

Error four:
An old or invalid version of a Sitefinity assembly entry in one of the project files in the solution.

Error/behavior:
After entering and running the "sf upgrade" command, the upgrade process hangs.

Error five:
Visual Studio Package Manager Console is not working.

Error six:
Environmental or corrupted Visual Studio instance.

Error seven:
Missing a Sitefinity license.
 
Resolution
For errors, one, two, and three:
Migrate the project to NuGet first by performing an upgrade following the NuGet path. After that, every subsequent upgrade can (and should) be done via the CLI tool. When the project is migrated to NuGet Packages it must be built which will create a .sln file (solution).

For error four:
Review the info: messages in the CLI command prompt and check if there is a Sitefinity version (Id='Telerik.Sitefinity.All' ,Version='x.xxxx.x') that does not match the current version of the project. Also, the current version that is detected by the CLI could be a very old one or non-existent. The upgrade command of the CLI initially goes through all project files (.csproj) in the solution and crawls all Sitefinity assembly declarations. In some cases, there are old entries that can result in error four due to a very old or a version that does not exist. The below screenshot serves as an example of the problem:
CLI Null Reference
As shown above, after finishing the detection functionality, in one of the project files, version 1.4.463 is marked which is not a valid one. The aforementioned version is then checked if it exists in the NuGet feeds, but it does not, thus resulting in the NotFound error. 

In order to resolve the above, proceed as the following (using the screenshot case as an example):
1. Navigate to the .csproj file with the invalid version. In this case, version 1.4.463.
2. Locate the entry with the above version. In this case, it looked like this:
<Reference Include="Telerik.Sitefinity.Mvc, Version=1.4.463.0, Culture=neutral, PublicKeyToken=b28c218413bdf563, processorArchitecture=MSIL">
Note that this is a very old entry which is also causing the problem. Only DLL references should be present in the project file.
3. Change the entry to this:
<Reference Include="Telerik.Sitefinity.Mvc">
4. Save the changes.
5. Run the upgrade with the CLI again.

In the above example, the root cause was only that entry. Keep in mind that there could be more old data in the project files. Use the CLI info: message to locate them and then modify them as shown in step 3.

Error/behavior:
Use Windows Command Prompt or PowerShell when working with the CLI tool.

Error five:
There is a problem preventing the Package Manager Console tool in Visual Studio to start. Try repairing the VS installation or refer to the following resources:
- Most likely a corrupted package.config - ask the user to discard all current changes to the project and restart the upgrade from scratch if repairing the packages.config fails
- StackOverflow, Package Manager console not working https://stackoverflow.com/questions/6891966/package-manager-console-not-working
- Developer Community Visual Studio, Package manager console not working https://developercommunity.visualstudio.com/t/package-manager-console-not-working/129129

Error six:
This problem usually happens when the Windows application in question is waiting for a modal dialog that is active or such and the application is not in a state to accept any commands. The error is thrown when VS is launched and probably a pop-up either from VS (settings, extensions) or one prompted by the CLI cannot be executed due to Visual Studio being busy. Search for "The message filter indicated that the application is busy. (0x8001010A (RPC_E_SERVERCALL_RETRYLATER))" online for more information regarding the problem.

Error seven:
Get a valid license for the version of Sitefinity to which it is being upgraded to. If the required license is for Sitefinity version 14+, refer to the following KB Download Sitefinity license.