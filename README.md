# myStream.cc Indexer

Download executables for myStream.cc, ready for use.

## version 0.0.1

- Windows : https://github.com/shukriadams/mystreamccindexer/releases/download/0.0.1/JustPlayItIndexer_Setup_0.0.1.exe
- Mac : Coming soon.
- Linux : Coming soon.

## Development stuff

This project also contains the source for the indexer. It is based on https://github.com/szwacz/electron-boilerplate, 4.3.0

Note for Windows - this project cannot be run in Vagrant or any VirtualBox host that shares folders with the host, as some of the gulp-based filesystem watchers will not permit this. Files must be stored on your VM's native disk.

### Setup

- Install Node 6.x
- in / to set up boilerplate,

    npm install 

- in /app to set up custom dependencies

    npm install 

### Dev
  
- in /

    npm start

### Build 

- in /

    npm run release     

Distributable binaries can be found in /dist.
