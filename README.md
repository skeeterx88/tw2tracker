# tw2tracker-docker

## Overview
This project sets up a Docker environment for the Tw2-Tracker application. It includes a Dockerfile for building the application image and a `compose.yaml` file for managing the application services.

## Getting Started

### Prerequisites
- Docker installed on your machine.
- Docker Compose installed.

### Building the Docker Image
To build the Docker image for the Tw2-Tracker application, run the following command in the project root directory:

```
docker build -t tw2tracker .
```

### Running the Application
To run the application using Docker Compose, execute the following command:

```
docker-compose up
```

This command will start all the services defined in the `compose.yaml` file.

### Stopping the Application
To stop the running application, use:

```
docker-compose down
```

### Additional Information
- Ensure that your environment variables are set correctly in the `compose.yaml` file.
- For any issues or contributions, please refer to the project's issue tracker.