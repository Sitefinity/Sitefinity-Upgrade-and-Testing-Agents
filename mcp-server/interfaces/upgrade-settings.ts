export interface UpgradeSettings {
    SitefinityUrl: string;
    SitefinityCLIPath: string;
    SourceFilesPath: string;
    SourceVersion: string;
    TargetVersion: string;
    BackendCredentials?: {
        username: string;
        password: string;
    };
}
