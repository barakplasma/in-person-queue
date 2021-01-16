# Getting Started

# Deploying to your infrastructure

You just need dokku. To get started with dokku locally
```sh
docker pull dokku/dokku:0.22.
```
then
```
docker run \
  --env DOKKU_HOSTNAME=<your domain name here> \
  --name dokku \
  --publish 3022:22 \
  --publish 8080:80 \
  --publish 8443:443 \
  --volume <full path to this folder>/chisonnumber/dokku:/mnt/dokku \
  --volume /var/run/docker.sock:/var/run/docker.sock \
  dokku/dokku:0.22.8
```
then
```
docker exec -it dokku bash
```

then copy your ssh key to the dokku folder
```
cp ~/.ssh/id_rsa.pub <full path to this folder>/chisonnumber/dokku/.ssh/
```

```
ssh-keys:add <your use name> id_rsa.pub
```

create the dokku app
```
dokku apps:create chisonnumber
```

add / connect redis
```
sudo dokku plugin:install https://github.com/dokku/dokku-redis.git redis
dokku redis:create lolipop
dokku redis:link lolipop chisonnumber
```

```
git remote add dokku dokku@localhost:chisonnumber
```
