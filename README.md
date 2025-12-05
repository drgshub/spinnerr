<p align="center">
  <img width="300" height="300" alt="logo" src="https://github.com/user-attachments/assets/b648eb5d-c621-42ef-8289-382f0db171a0" />
</p>
    
Spinnerr is a lightweight Node.js-based tool that automatically starts Docker containers when they are accessed through a defined web route and stops them after a configurable idle timeout. Works best with Nginx Proxy Manager as a reverse proxy.

## Features

* Automatic container management: Containers start on demand when a user accesses their web route.
* Idle timeout: Containers automatically stop after a specified period of inactivity.
* Reverse proxy compatible: Integrates with Nginx; routes are defined via container hostnames and ports.
* Configurable via web UI: Optional UI to add, edit, or remove container entries and set idle timeouts.
* Container groups: containers can be grouped to be started and stopped together.
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
All example configurations with Docker Compose can be found in the [docker-compose.yml file](https://github.com/drgshub/spinnerr/blob/main/docker-compose.yml)

## Usage

The tool can be configured to run both with a docker socket proxy, with the socket mounted or the host network mode.

>#### 1. Using a Socket Proxy
>
>a. Single Network Setup
>When using a socket proxy with only Spinnerr and the Docker Socket Proxy in a single network, you must use the Docker hostname and the external port.
>
>b. Multi-Container Network Setup
>When using a socket proxy with all managed containers, along with Spinnerr and the Docker Socket Proxy in the same network, you can connect using either:
>	•	The Docker hostname and external port, or
>	•	The internal container name and internal port.
>
>#### 2. Socket Mounted Directly on Spinnerr
>
>If the Docker socket is mounted directly on Spinnerr, you can use either of the above configurations, without the need for a Docker Socket Proxy.
>
>#### 3. Network Mode: host
>
>When using host network mode, only the external address and external IP are supported for connecting.

If you'd like to use the tool with the docker socket proxy make sure you add the enviorment variable DOCKER_PROXY_URL pointing to your proxy container (e.g. tcp://docker-socket-proxy:2375) and to maintain the container is the same network as the proxy.

Configuration can be changed from the WebUI, which can be accessed as http://localhost:<UI_PORT>, or can be edited manually in the config.json file. No container restart is needed in either cases.

Although the tool supports basic HTTP reverse proxying, it’s generally better to rely on a dedicated reverse proxy like NGINX. If you decide to use NGINX, ensure it redirects traffic to the container’s appropriate listening port. For example:

```
{
  "containers": [
    {
      "name": "flame", <--------- name of the container in the docker network
      "url": "http://flame:5005", <----- web access of the container in the docker network
      "idleTimeout": 180000,  <-------- timeout after no webrequests have been received
      "host": "flame.mydomain.com" <------- domain used to access the service
    }
  ...
}
```

For the above example, Nginx needs to point to <host-ip>:<PORT>, where PORT is defined in the environment variables.

## Web UI

### Dashboard

<img width="1710" height="629" alt="image" src="https://github.com/user-attachments/assets/7d66700e-965b-48a2-8c41-aa8e1e343244" />

And dark mode:

<img width="1710" height="674" alt="image" src="https://github.com/user-attachments/assets/5b01bab5-864a-4127-89f9-e8cd7e20b1e5" />

### Adding a container

<img width="1710" height="750" alt="image" src="https://github.com/user-attachments/assets/02bc5dbf-1a2d-47c8-b354-7b89f9265d37" />

### Editing existing configuration

<img width="1710" height="674" alt="image" src="https://github.com/user-attachments/assets/49eb74aa-e9c9-4a34-8160-eaf1567aedcd" />

<img width="1710" height="745" alt="image" src="https://github.com/user-attachments/assets/a8dd7ef3-ee01-4c35-a230-1372b6245106" />



## Variables

Variable | Usage 
--- | ---
PORT | Port of the reverse proxy
UI_PORT | Port of the Web UI
DOCKER_PROXY_URL | Address of the socket proxy, must start with tcp://

## License

Spinnerr is licensed under the [Apache License 2.0](./LICENSE).  
See the LICENSE file for details.
