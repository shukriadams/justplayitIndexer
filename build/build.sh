set -e # fail on errors

# capture all arguments passed in (anything starting with --)
while [ $# -gt 0 ]; do
    if [[ $1 == *"--"* ]]; then
        param="${1/--/}"
        declare $param="$2"
    fi
    shift
done

repo="shukriadams/tuna-indexer"

# force get tags, these don't always seem to be pulled by jenkins
git fetch --all --tags

# get current revision the checkout is on
currentRevision=$(git rev-parse --verify HEAD) 

# get tag on this revision
tag=$(git describe --contains $currentRevision)

# ensure current revision is tagged
if [ -z "$tag" ]; then
    echo "ERROR : current revision has no tag on it, cannot upload";
    exit 1;
fi

if [ "$target" = "" ]; then
    echo "ERROR : --target not set"
    exit 1;
fi


# clean up
cd ..
rm -rf ./dist
cd -


# install required
cd ..
npm install 
cd -


cd ./../app 
npm install
cd -


# build
cd ..
npm run release

if [ "$target" = "linux64" ]; then
    rawFilename="TunaIndexer Setup 0.0.0"
    outFilename="TunaIndexer_Setup_linux64_${tag}"
elif [ "$target" = "win64" ]; then
    rawFilename="TunaIndexer Setup 0.0.0.exe"
    outFilename="TunaIndexer_Setup_win64_${tag}.exe"
else
    echo "ERROR : ${target} is not a valid --target, allowed values are [linux64|win64]"
    exit 1;
fi

if [ ! -f "./dist/${rawFilename}" ]; then
    echo "ERROR - build file not found"
fi

cd ./dist
mv "./${rawFilename}" ./${outFilename}

echo "Build succeeded"

if [ ! "$upload" = 1 ]; then
    exit 0
fi

# ensure required arguments
if [ -z "$repo" ]; then
    echo "--repo : github repo is required";
    exit 1;
fi

if [ -z "$token" ]; then
    echo "--token : github api token is required";
    exit 1;
fi

GH_REPO="https://api.github.com/repos/$repo"
GH_TAGS="$GH_REPO/releases/tags/$tag"
AUTH="Authorization: token $token"
WGET_ARGS="--content-disposition --auth-no-challenge --no-cookie"
CURL_ARGS="-LJO#"

# Validate token.
curl -o /dev/null -sH "$token" $GH_REPO || { echo "Error : token validation failed";  exit 1; }

# Read asset tags.
response=$(curl -sH "$token" $GH_TAGS)

# Get ID of the asset based on given filename.
eval $(echo "$response" | grep -m 1 "id.:" | grep -w id | tr : = | tr -cd '[[:alnum:]]=')
[ "$id" ] || { echo "Error : Failed to get release id for tag: $tag"; echo "$response" | awk 'length($0)<100' >&2; exit 1; }

# upload file to github
GH_ASSET="https://uploads.github.com/repos/$repo/releases/$id/assets?name=${outFilename}"
curl --silent --data-binary @"${outFilename}" -H "Authorization: token $token" -H "Content-Type: application/octet-stream" $GH_ASSET

echo "App uploaded"

cd -
