# myStream.cc Indexer

Indexes your music files, making them ready to play through [myStream.cc](https://www.mystream.cc)

- Windows : [Download version 0.0.2](https://github.com/shukriadams/mystreamccindexer/releases/download/0.0.2/myStreamCCIndexer_Setup_0.0.2.exe)
- Mac : Coming soon.
- Linux : Coming soon.

## Development stuff

This project also contains the source for the indexer. It is based on https://github.com/szwacz/electron-boilerplate, 4.3.0

Note for Windows - this project cannot be run in Vagrant or any VirtualBox host that shares folders with the host, as some of the gulp-based filesystem watchers will not permit this. Files must be stored on your VM's native disk.

### Setup

- Install Node 6.x or higher.
- Run

    npm install 
    cd /app
    npm install

### Dev
  
- Run

    npm start

To test the app, point it to a folder containing a ".dropbox" subfolder, this is used as a flag that the folder is being controlled by Dropbox. The app generates a ".myStream.dat" file, which contains XML data.

### Build 

- update package.json in the /app folder with latest version number.
- Run

    npm run release     

Distributable binaries can be found in /dist.
