// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import fs = require("fs");
import path = require("path");
import os = require("os");

import stack = require("./stack");
import {GitLocator} from "./gitLocator";
import {ProjectsSorter} from "./sorter";
import {Project, ProjectStorage} from "./storage";
import {SvnLocator} from "./svnLocator";
import {VisualStudioCodeLocator} from "./vscodeLocator";

const homeDir = os.homedir();
const homePathVariable = "$home";
const PROJECTS_FILE = "projects.json";

// vscode projects support
const MERGE_PROJECTS: boolean = true;

const enum ProjectsSource {
    Projects,
    VSCode,
    Git,
    Svn
}

export interface ProjectsSourceSet extends Array<ProjectsSource> {};

let vscLocator: VisualStudioCodeLocator = new VisualStudioCodeLocator();
let gitLocator: GitLocator = new GitLocator();
let svnLocator: SvnLocator = new SvnLocator();

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    let recentProjects: string = context.globalState.get<string>("recent", "");
    let aStack: stack.StringStack = new stack.StringStack();
    aStack.fromString(recentProjects);

    // load the projects
    let projectStorage: ProjectStorage = new ProjectStorage(getProjectFilePath());
    let errorLoading: string = projectStorage.load();

    // register commands (here, because it needs to be used right below if an invalid JSON is present)
    vscode.commands.registerCommand("projectManager.saveProject", () => saveProject());
    vscode.commands.registerCommand("projectManager.refreshProjects", () => refreshProjects());
    vscode.commands.registerCommand("projectManager.editProjects", () => editProjects());
    vscode.commands.registerCommand("projectManager.listProjects", () => listProjects(false, [ProjectsSource.Projects, ProjectsSource.VSCode, ProjectsSource.Git, ProjectsSource.Svn]));
    vscode.commands.registerCommand("projectManager.listProjectsNewWindow", () => listProjects(true, [ProjectsSource.Projects, ProjectsSource.VSCode, ProjectsSource.Git, ProjectsSource.Svn]));

    // how to handle now, since the extension starts 'at load'?
    if (errorLoading !== "") {
        let optionOpenFile = <vscode.MessageItem> {
            title: "Open File"
        };
        vscode.window.showErrorMessage("Error loading projects.json file. Message: " + errorLoading, optionOpenFile).then(option => {
            // nothing selected
            if (typeof option === "undefined") {
                return;
            }

            if (option.title === "Open File") {
                vscode.commands.executeCommand("projectManager.editProjects");
            } else {
                return;
            }
        });
        return null;
    }

    let statusItem: vscode.StatusBarItem;
    showStatusBar();

    // function commands
    function showStatusBar(projectName?: string) {
        let showStatusConfig = vscode.workspace.getConfiguration("projectManager").get("showProjectNameInStatusBar");
        let currentProjectPath = vscode.workspace.rootPath;

        if (!showStatusConfig || !currentProjectPath) { return; }

        if (!statusItem) {
            statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        }
        statusItem.text = "$(file-directory) ";
        statusItem.tooltip = currentProjectPath;
        if (vscode.workspace.getConfiguration("projectManager").get("openInNewWindow", true)) {
            statusItem.command = "projectManager.listProjectsNewWindow";
        } else {
            statusItem.command = "projectManager.listProjects";
        }

        // if we have a projectName, we don't need to search.
        if (projectName) {
            statusItem.text += projectName;
            statusItem.show();
            return;
        }

        if (projectStorage.length() === 0) {
            return;
        }

        let foundProject: Project = projectStorage.existsWithRootPath(compactHomePath(currentProjectPath));
        if (foundProject) {
            statusItem.text += foundProject.name;
            statusItem.show();
        }
    };

    function refreshProjects() {
        vscLocator.refreshProjects();
        gitLocator.refreshProjects();
        svnLocator.refreshProjects();
        vscode.window.showInformationMessage("The projects have been refreshed!");
    };

    function editProjects() {
        if (fs.existsSync(getProjectFilePath())) {
            vscode.workspace.openTextDocument(getProjectFilePath()).then(doc => {
                vscode.window.showTextDocument(doc);
            });
        } else {
            let optionEditProject = <vscode.MessageItem> {
                title: "Yes, edit manually"
            };
            vscode.window.showErrorMessage("No projects saved yet! You should open a folder and use Save Project instead. Do you really want to edit manually? ", optionEditProject).then(option => {
                // nothing selected
                if (typeof option === "undefined") {
                    return;
                }

                if (option.title === "Yes, edit manually") {
                    // var items = [];
                    // items.push({ label: 'Project Name', description: 'Project Path' });
                    // fs.writeFileSync(getProjectFilePath(), JSON.stringify(items, null, "\t"));
                    projectStorage.push("Project Name", "Root Path", "");
                    projectStorage.save();
                    vscode.commands.executeCommand("projectManager.editProjects");
                } else {
                    return;
                }
            });
        }
    };

    function saveProject() {
        // Display a message box to the user
        let wpath = vscode.workspace.rootPath;
        if (process.platform === "win32") {
            wpath = wpath.substr(wpath.lastIndexOf("\\") + 1);
        } else {
            wpath = wpath.substr(wpath.lastIndexOf("/") + 1);
        }

        // ask the PROJECT NAME (suggest the )
        let ibo = <vscode.InputBoxOptions> {
            prompt: "Project Name",
            placeHolder: "Type a name for your project",
            value: wpath
        };

        vscode.window.showInputBox(ibo).then(projectName => {
            if (typeof projectName === "undefined") {
                return;
            }

            // 'empty'
            if (projectName === "") {
                vscode.window.showWarningMessage("You must define a name for the project.");
                return;
            }

            let rootPath = compactHomePath(vscode.workspace.rootPath);

            // var items = []
            // if (fs.existsSync(getProjectFilePath())) {
            //     items = loadProjects(getProjectFilePath());
            //     if (items == null) {
            //         return;
            //     }
            // }

            // var found: boolean = false;
            // for (var i = 0; i < items.length; i++) {
            //     var element = items[i];
            //     if (element.label == projectName) {
            //         found = true;
            //     }
            // }

            if (!projectStorage.exists(projectName)) {
                aStack.push(projectName);
                context.globalState.update("recent", aStack.toString());
                projectStorage.push(projectName, rootPath, "");
                projectStorage.save();
                // items.push({ label: projectName, description: rootPath });
                // fs.writeFileSync(getProjectFilePath(), JSON.stringify(items, null, "\t"));
                vscode.window.showInformationMessage("Project saved!");
                showStatusBar(projectName);
            } else {
                let optionUpdate = <vscode.MessageItem> {
                    title: "Update"
                };
                let optionCancel = <vscode.MessageItem> {
                    title: "Cancel"
                };

                vscode.window.showInformationMessage("Project already exists!", optionUpdate, optionCancel).then(option => {
                    // nothing selected
                    if (typeof option === "undefined") {
                        return;
                    }

                    if (option.title === "Update") {
                        // for (var i = 0; i < items.length; i++) {
                        //     if (items[i].label == projectName) {
                        //         items[i].description = rootPath;
                                aStack.push(projectName);
                                context.globalState.update("recent", aStack.toString());
                                projectStorage.updateRootPath(projectName, rootPath);
                                projectStorage.save();
//                                fs.writeFileSync(getProjectFilePath(), JSON.stringify(items, null, "\t"));
                                vscode.window.showInformationMessage("Project saved!");
                                showStatusBar(projectName);
                                return;
                        //     }
                        // }
                    } else {
                        return;
                    }
                });
            }
        });
    };

    function sortProjectList(items): any[] {
        let itemsToShow = expandHomePaths(items);
        itemsToShow = removeRootPath(itemsToShow);
        itemsToShow = indicateInvalidPaths(itemsToShow);
        let sortList = vscode.workspace.getConfiguration("projectManager").get("sortList", "Name");
        let newItemsSorted = ProjectsSorter.SortItemsByCriteria(itemsToShow, sortList, aStack);
        return newItemsSorted;
    }

    function getProjects(itemsSorted: any[], sources: ProjectsSourceSet): Promise<{}> {

        return new Promise((resolve, reject) => {

            if (sources.indexOf(ProjectsSource.Projects) === -1) {
                resolve([]);
            } else {
                resolve(itemsSorted);
            }

        });
    }

    function getVSCodeProjects(itemsSorted: any[], merge: boolean): Promise<{}> {

        return new Promise((resolve, reject) => {

            vscLocator.locateProjects(vscode.workspace.getConfiguration("projectManager").get("vscode.baseFolders"))
                .then((dirList) => {
                    let newItems = [];
                    newItems = dirList.map(item => {
                        return {
                            description: item.fullPath,
                            label: "$(file-code) " + item.name
                        };
                    });

                    if (merge) {
                        let unifiedList = newItems.concat(itemsSorted);
                        resolve(unifiedList);
                    } else {
                        resolve(newItems);
                    }
                });
        });
    }

    function getGitProjects(itemsSorted: any[], merge: boolean): Promise<{}> {

        return new Promise((resolve, reject) => {

            gitLocator.locateProjects(vscode.workspace.getConfiguration("projectManager").get("git.baseFolders"))
                .then((dirList) => {
                    let newItems = [];
                    newItems = dirList.map(item => {
                        return {
                            label: "$(git-branch) " + item.name,
                            description: item.fullPath
                            // "label": '$(mark-github) ' + path.basename(item.fullPath),
                            // "description": item.fullPath,
                            // "detail": item.name
                        };
                    });

                    if (merge) {
                        let unifiedList = newItems.concat(itemsSorted);
                        resolve(unifiedList);
                    } else {
                        resolve(newItems);
                    }
                });
        });
    }

    function getSvnProjects(itemsSorted: any[], merge: boolean): Promise<{}> {

        return new Promise((resolve, reject) => {

            svnLocator.locateProjects(vscode.workspace.getConfiguration("projectManager").get("svn.baseFolders"))
                .then((dirList) => {
                    let newItems = [];
                    newItems = dirList.map(item => {
                        return {
                            label: "$(zap) " + item.name,
                            description: item.fullPath
                            // "label": '$(mark-github) ' + path.basename(item.fullPath),
                            // "description": item.fullPath,
                            // "detail": item.name
                        };
                    });

                    if (merge) {
                        let unifiedList = newItems.concat(itemsSorted);
                        resolve(unifiedList);
                    } else {
                        resolve(newItems);
                    }
                });
        });
    }

    function listProjects(forceNewWindow: boolean, sources: ProjectsSourceSet) {
        let items = [];

        // if (fs.existsSync(getProjectFilePath())) {
        //     items = loadProjects(getProjectFilePath());
        //     if (items == null) {
        //         return;
        //     }
        // } else {
        // if (projectStorage.length() == 0) {
        //     vscode.window.showInformationMessage('No projects saved yet!');
        //     return;
        // }
        items = projectStorage.map();

        function onRejectListProjects(reason) {
            vscode.window.showInformationMessage("Error loading projects: ${reason}");
        }

        // promisses
        function onResolve(selected) {
            if (!selected) {
                return;
            }

           // vscode.window.showInformationMessage(selected.label);

            if (!fs.existsSync(selected.description.toString())) {
                let optionUpdateProject = <vscode.MessageItem> {
                    title: "Update Project"
                };
                let optionDeleteProject = <vscode.MessageItem> {
                    title: "Delete Project"
                };

                vscode.window.showErrorMessage("The project has an invalid path. What would you like to do?", optionUpdateProject, optionDeleteProject).then(option => {
                    // nothing selected
                    if (typeof option === "undefined") {
                        return;
                    }

                    if (option.title === "Update Project") {
                        vscode.commands.executeCommand("projectManager.editProjects");
                    } else { // Update Project
                        // let itemsFiltered = [];
                        // itemsFiltered = items.filter(value => value.description.toString().toLowerCase() != selected.description.toLowerCase());
                        // fs.writeFileSync(getProjectFilePath(), JSON.stringify(itemsFiltered, null, "\t"));
                        projectStorage.pop(selected);
                        projectStorage.save();
                        return;
                    }
                });
            } else {
                // project path
                let projectPath = selected.description;
                projectPath = normalizePath(projectPath);

                // update MRU
                aStack.push(selected.label);
                context.globalState.update("recent", aStack.toString());

                let openInNewWindow: boolean = vscode.workspace.getConfiguration("projectManager").get("openInNewWindow", true);
                let uri: vscode.Uri = vscode.Uri.file(projectPath);
                vscode.commands.executeCommand("vscode.openFolder", uri, openInNewWindow || forceNewWindow)
                    .then(
                        value => ( {} ),  // done
                        value => vscode.window.showInformationMessage("Could not open the project!") );
            }
        }

        let options = <vscode.QuickPickOptions> {
            matchOnDescription: false,
            matchOnDetail: false,
            placeHolder: "Loading Projects (pick one to open)"
        };

        getProjects(items, sources)
            .then((folders) => {

                // not in SET
                if (sources.indexOf(ProjectsSource.VSCode) === -1) {
                    return folders;
                }

                // has PROJECTS and is NOT MERGED - always merge
                // if ((sources.indexOf(ProjectsSource.Projects) > -1)  && (!<boolean>vscode.workspace.getConfiguration('projectManager').get('vscode.mergeProjects', true))) {
                //     return folders;
                // }

                // Ok, can have VSCode
                let merge: boolean = MERGE_PROJECTS; // vscode.workspace.getConfiguration('projectManager').get('vscode.mergeProjects', true);
                return getVSCodeProjects(<any[]> folders, merge);
            })
            .then((folders) => {
                if (sources.indexOf(ProjectsSource.Git) === -1) {
                    return folders;
                }
                let merge: boolean = MERGE_PROJECTS;
                return getGitProjects(<any[]> folders, merge);
            })
            .then((folders) => {
                if (sources.indexOf(ProjectsSource.Svn) === -1) {
                    return folders;
                }
                let merge: boolean = MERGE_PROJECTS;
                return getSvnProjects(<any[]> folders, merge);
            })
            .then((folders) => { // sort
                if ((<any[]> folders).length === 0) {
                    vscode.window.showInformationMessage("No projects saved yet!");
                    return;
                } else {
                    vscode.window.showQuickPick(sortProjectList(folders), options)
                        .then(onResolve, onRejectListProjects);
                }
            });
    };

    function removeRootPath(items: any[]): any[] {
        if (!vscode.workspace.rootPath) {
            return items;
        } else {
            return items.filter(value => value.description.toString().toLowerCase() !== vscode.workspace.rootPath.toLowerCase());
        }
    }

    function indicateInvalidPaths(items: any[]): any[] {
        // for (let index = 0; index < items.length; index++) {
        for (let element of items) {
            // let element = items[index];

            if (!element.detail && (!fs.existsSync(element.description.toString()) )) {
                // items[index].detail = "$(circle-slash) Path does not exist";
                element.detail = "$(circle-slash) Path does not exist";
            }
        }

        return items;
    }

    function pathIsUNC(path: string) {
      return path.indexOf("\\\\") === 0;
    }

    /**
     * If the project path is in the user's home directory then store the home directory as a
     * parameter. This will help in situations when the user works with the same projects on
     * different machines, under different user names.
     */
    function compactHomePath(path: string) {
        if (path.indexOf(homeDir) === 0) {
            return path.replace(homeDir, homePathVariable);
        }

        return path;
    }

    /**
     * Expand $home parameter from path to real os home path
     */
    function expandHomePath(path: string) {
        if (path.indexOf(homePathVariable) === 0) {
            return path.replace(homePathVariable, homeDir);
        }

        return path;
    }

    function expandHomePaths(items: any[]) {
        return items.map(item => {
            item.description = expandHomePath(item.description);
            return item;
        });
    }

    function normalizePath(path: string): string {
        let normalizedPath: string = path;

        if (!pathIsUNC(normalizedPath)) {
          let replaceable = normalizedPath.split("\\");
          normalizedPath = replaceable.join("\\\\");
        }

        return normalizedPath;
    }

    // function loadProjects(file: string): any[] {
    //     var items = [];
    //     try {
    //         items = JSON.parse(fs.readFileSync(file).toString());
    //         return items;
    //     } catch (error) {
    //         var optionOpenFile = <vscode.MessageItem>{
    //             title: "Open File"
    //         };
    //         vscode.window.showErrorMessage('Error loading projects.json file. Message: ' + error.toString(), optionOpenFile).then(option => {
    //             // nothing selected
    //             if (typeof option == 'undefined') {
    //                 return;
    //             }

    //             if (option.title == "Open File") {
    //                 vscode.commands.executeCommand('projectManager.editProjects');
    //             } else {
    //                 return;
    //             }
    //         });
    //         return null;
    //     }
    // }

    function getChannelPath(): string {
        if (vscode.env.appName.indexOf("Insiders") > 0) {
            return "Code - Insiders";
        } else {
            return "Code";
        }
    }

    function getProjectFilePath() {
        let projectFile: string;
        let projectsLocation: string = vscode.workspace.getConfiguration("projectManager").get<string>("projectsLocation");
        if (projectsLocation !== "") {
            projectFile = path.join(projectsLocation, PROJECTS_FILE);
        } else {
            let appdata = process.env.APPDATA || (process.platform === "darwin" ? process.env.HOME + "/Library/Application Support" : "/var/local");
            let channelPath: string = getChannelPath();
            projectFile = path.join(appdata, channelPath, "User", PROJECTS_FILE);
            // in linux, it may not work with /var/local, then try to use /home/myuser/.config
            if ((process.platform === "linux") && (!fs.existsSync(projectFile))) {
                projectFile = path.join(homeDir, ".config/", channelPath, "User", PROJECTS_FILE);
            }
        }
        return projectFile;
    }
}
