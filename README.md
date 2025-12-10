<p align="center">
  <img width="300" height="300" alt="logo" src="https://github.com/user-attachments/assets/b648eb5d-c621-42ef-8289-382f0db171a0" />
</p>
    
Spinnerr is a lightweight Node.js-based service that automatically starts Docker containers when accessed through a defined web route and stops them after a configurable idle timeout or on a set schedule, either individually or as part of a group.

## Features

* Automatic container management: Containers start on demand when a user accesses their web route.
* Idle timeout: Containers automatically stop after a specified period of inactivity.
* Reverse proxy compatible: Integrates with Nginx; routes are defined via container hostnames and ports.
* Configurable via web UI: Optional UI to add, edit, or remove container entries and set idle timeouts.
* Container groups: containers can be grouped to be started and stopped together.
* Lightweight and efficient: Minimal overhead, runs as a Docker container itself.
* Scheduler for containers: Automate start/stop of containers or groups based on time and day.
  
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
      "idleTimeout": 180000,  <-------- timeout after no webrequests have been received, 0 will disable stopping the container after timeout
      "host": "flame.mydomain.com" <------- domain used to access the service
    }
  ...
}
```

For the above example, Nginx needs to point to <host-ip>:<PORT>, where PORT is defined in the environment variables.

## Groups

Containers added in Spinnerr can be grouped up in order to be stopped and started together. As long as the group is active, the timeout will override the individual container timeout. Same as containers, the idle timeout can be set to 0 in order to prevent stopping the containers after the timeout is reached (this value still overides the individual container timeout). If a container from the group is disabled, group actions will not have any impact on it. 

If you need to create a group consiting of a main web application + database container or other reference container which doesn't require web access, you can set a dummy value for the reference container's internal and external host - this way the reference containers will not be started and stopped based on web requests, only as part of the group of which they are part of.

<img width="1710" height="747" alt="image" src="https://github.com/user-attachments/assets/e45a7101-4364-4fb8-82c0-28f1c73e2883" />

<img width="1709" height="758" alt="image" src="https://github.com/user-attachments/assets/d6082613-9922-460e-a0fd-8370c7ed7532" />

## Scheduler

You can schedule containers and groups to start and stop based on time and weekdays. Multiple rules can be created to run in parallel.

Do note that:
* The container/group needs to be active in order for the scheduler to work
* The timeout of the container/group overides the schedule, so if the idle timeout should stop the container before reaching the scheduled stop, it will
* In order to prevent this behaviour, you can set the timeout of the container/group to 0
* You can edit, disable or delete any of the created schedules

<img width="1710" height="772" alt="image" src="https://github.com/user-attachments/assets/396e9acf-4413-49af-862b-4ff3bd90c2ca" />

## Web UI

### Dashboard

<img width="1710" height="685" alt="image" src="https://github.com/user-attachments/assets/42f5b3bf-00aa-4266-9880-72b293c21643" />

Dark mode:

<img width="1710" height="693" alt="image" src="https://github.com/user-attachments/assets/663bb04f-3a09-4c01-a099-328d56a32768" />


### Adding a container

<img width="1710" height="802" alt="image" src="https://github.com/user-attachments/assets/019486c1-4438-431f-8cc5-2e47b9223250" />

### Editing existing configuration

<img width="1710" height="864" alt="image" src="https://github.com/user-attachments/assets/7497f732-fd31-40d7-b164-d91524c4af5c" />


## Variables

Variable | Usage 
--- | ---
PORT | Port of the reverse proxy
UI_PORT | Port of the Web UI
DOCKER_PROXY_URL | Address of the socket proxy, must start with tcp://

## Contribute

<a href="https://buymeacoffee.com/dragosul">
  <img 
    src="https://github.com/user-attachments/assets/b43734fe-aa49-4e1e-862e-83ec5ac65526"
    width="300" 
    height="180"
    alt="image"
  />
</a>

## License

Spinnerr is licensed under the [Apache License 2.0](./LICENSE).  
See the LICENSE file for details.

----------


