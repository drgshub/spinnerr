<p align="center">
  <img width="250" height="250" alt="image" src="https://github.com/user-attachments/assets/4d7058ee-a1d2-4dee-8a43-451c36ba524f" />
</p>

Spinnerr is a lightweight Node.js-based tool that automatically starts Docker containers when they are accessed through a defined web route and stops them after a configurable idle timeout. Works best with Nginx Proxy Manager as a reverse proxy. This tool is heavily inspired by https://github.com/ItsEcholot/ContainerNursery

## Features

* Automatic container management: Containers start on demand when a user accesses their web route.
* Idle timeout: Containers automatically stop after a specified period of inactivity.
* Reverse proxy compatible: Integrates with Nginx; routes are defined via container hostnames and ports.
* Configurable via web UI: Optional UI to add, edit, or remove container entries and set idle timeouts.
* Lightweight and efficient: Minimal overhead, runs as a Docker container itself.

## Installation

The package can be pulled directly from GitHub with Docker pull or Docker Compose.

##### Pull the repository
```
docker pull ghcr.io/drgshub/spinnerr:latest
```
### Docker run
```
docker run -d \
  --name spinnerr \
  --restart unless-stopped \
  -p 10000:10000 \
  -p 11000:11000 \
  --network spinnerr \
  --network proxynetwork \
  -e PORT=10000 \
  -e UI_PORT=11000 \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /path/to/spinnerr/config:/app/config \
  ghcr.io/drgshub/spinnerr:latest
```
### Docker Compose
```
version: "3.9"

services:
  spinnerr:
    image: ghcr.io/drgshub/spinnerr:latest
    container_name: spinnerr
    ports:
      - "10000:10000"
      - "11000:11000"
    restart: unless-stopped
    networks:
      - proxynetwork
      - spinnerr
    environment:
      - PORT=10000
      - UI_PORT=11000
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /path/to/spinnerr/config:/app/config

networks:
  spinnerr:
    external: true
```

## Usage

The tool can be configured to run both with a docker socket proxy, with the socket mounted or the host network mode.

If you'd like to use the tool with the docker socket proxy make sure you add the enviorment variable DOCKER_PROXY_URL pointing to your proxy container (e.g. tcp://docker-socket-proxy:2375) and to maintain the container is the same network as the proxy.

Configuration can be changed from the WebUI, which can be accessed as http://localhost:<UI_PORT>, or can be edited manually in the config.json file. No container restart is needed in either cases.

NGINX needs to forward the connections to the listening port. Take this example:

```
{
  "port": 10000,     <----not used
  "containers": [
    {
      "name": "flame", <--------- name of the container in the docker network
      "url": "http://flame:5005", <----- web access of the container in the docker network
      "idleTimeout": 180000,  <-------- timeout after no webrequests have been received
      "host": "flame.mydomain.com" <------- domain used to access the service
    }
  ]
}
```

For the above example, Nginx needs to point to <host-ip>:<PORT>, where PORT is defined in the environment variables.

## Example configurations with Docker Compose

### With socket mounted

This approach requires the use of the internal docker IPs, named and ports in config.json. It also requires all the containers to be part of the spinnerr docker network (or any other internal docker network).

```
services:
  spinnerr:
    image: ghcr.io/drgshub/spinnerr:latest
    container_name: spinnerr
    ports:
      - "10000:10000"
      - "11000:11000"
    restart: unless-stopped
    networks:
      - proxynetwork
      - spinnerr
    environment:
      - PORT=10000
      - UI_PORT=11000
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /path/to/spinnerr/config:/app/config

networks:
  spinnerr:
    external: true
```

### Using Docker Socket Proxy

This approach requires the use of the internal docker IPs, names and ports in config.json. It also requires all the containers to be part of the spinnerr docker network, including the Docker Socker Proxy network. For the below example I have used one network for Spinnerr and the containers to be managed, and a different network for Spinnerr and the Socket Proxy.

```
services:
  spinnerr:
    image: ghcr.io/drgshub/spinnerr:latest
    container_name: spinnerr
    ports:
      - "10000:10000"
      - "11000:11000"
    restart: unless-stopped
    networks:
      - proxynetwork
      - spinnerr
    environment:
      - PORT=10000
      - UI_PORT=11000
      - DOCKER_PROXY_URL=tcp://docker-socket-proxy:2375
    volumes:
      - /path/to/spinnerr/config:/app/config
networks:
  spinnerr:
    external: true
  proxynetwork:
    external: true
```

### Using host network mode

This approach requires the use of the IP of the machine on which the containers to be managed are running and the external ports of the docker containers in config.json.

```
services:
  spinnerr:
    image: ghcr.io/drgshub/spinnerr:latest
    container_name: spinnerr
    ports:
      - "10000:10000"
      - "11000:11000"
    restart: unless-stopped
    networks:
      - proxynetwork
      - spinnerr
    environment:
      - PORT=10000
      - UI_PORT=11000
    volumes:
      - /path/to/spinnerr/config:/app/config
      - /var/run/docker.sock:/var/run/docker.sock
    restart: unless-stopped
    network_mode: host
```

## Web UI

### Dashboard

<img width="1710" height="693" alt="image" src="https://github.com/user-attachments/assets/a7f78169-64b2-41a9-baa9-d237c07535ec" />

### Adding a container

<img width="1710" height="772" alt="image" src="https://github.com/user-attachments/assets/62c7d523-a883-41fe-b93d-60d47115b68d" />

### Editing existing configuration

<img width="1710" height="857" alt="image" src="https://github.com/user-attachments/assets/deab1ed6-7028-4af6-ab57-f0b39aa24159" />


## Variables

Variable | Usage 
--- | ---
PORT | Port of the reverse proxy
UI_PORT | Port of the Web UI
DOCKER_PROXY_URL | Address of the socket proxy, must start with tcp://

## License

Spinnerr is licensed under the [Apache License 2.0](./LICENSE).  
See the LICENSE file for details.
