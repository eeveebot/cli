// docker-bake.hcl
target "docker-metadata-action" {}

target "build" {
  inherits = ["docker-metadata-action"]
  context = "./toolbox/"
  dockerfile = "./Dockerfile"
  platforms = [
    "linux/amd64",
    "linux/arm64",
  ]
  secret = [
    "type=env,id=GITHUB_TOKEN"
  ]
}
