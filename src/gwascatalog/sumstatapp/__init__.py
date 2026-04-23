import importlib.metadata

try:
    __version__ = importlib.metadata.version("gwascatalog.sumstatapp")
except importlib.metadata.PackageNotFoundError:
    __version__ = "dev"
