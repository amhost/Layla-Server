import { contextBridge, ipcRenderer } from "electron";

/**
 * Subscribe to a main-process channel, returning a cleanup function.
 */
function subscribe(channel: string, callback: (data: string) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, data: string) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("electronBridge", {
    getAppVersion: (): Promise<string> => ipcRenderer.invoke("get-app-version"),
    openExternal: (url: string) => ipcRenderer.send("open-external", url),

    /**
     * Start the llama.cpp server process.
     */
    startServer: (
        serverPath: string,
        modelPath: string,
        visionModelPath: string,
        additionalArgs: string,
    ): Promise<void> => {
        return ipcRenderer.invoke('server:start', serverPath, modelPath, visionModelPath, additionalArgs);
    },

    onServerStdout: (callback: (data: string) => void) => subscribe("server:stdout", callback),
    onServerStderr: (callback: (data: string) => void) => subscribe("server:stderr", callback),

    /**
     * Stop the llama.cpp server process.
     */
    stopServer: (): Promise<void> => {
        return ipcRenderer.invoke('server:stop');
    },

    /**
     * Get the machine's device / host name.
     */
    getDeviceName: (): Promise<string> => {
        return ipcRenderer.invoke('device:name');
    },

    /**
     * Open a file dialog to select a model file, returning the selected file path.
     * @returns the path of the selected model file, or null if the dialog was cancelled
     */
    openFileDialog: () => ipcRenderer.invoke("dialog:openFile"),

    /**
     * Show an alert dialog with a message and optional title.
     */
    showAlert: (title: string, message: string) => ipcRenderer.invoke('dialog:alert', title, message),
});