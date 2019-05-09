import os
import glob
import numpy as np
import argparse

"""
Script to create cone coordinates (i.e. bounding boxes without size, for now) from segementation labels
pass a glob to one or more .pcd files that were saved with the "saveOnline" function of this editor
saves the result as filename.pcd.labels respectively in the format
Example use: "spaxx.py ./data/labelled/**/*.pcd" 
x y z labels
1.2345 2.111 5.025 2
...
"""


def distance(a, b):
    return np.sqrt(np.sum((a-b)**2))

def readFile(path):
    with open(path, "r") as file:
        data = file.read()
        file.close()
        return data

def parsePcd(data):
    """
    Accepts a .pcd file in string format
    Returns a tuple (fields, np_content) where fields is a list of strings
    describing the fields each point has and np_content is a numpy array
    of size (n, len(fields)) with the data, i.e. n points with values
    corresponding to each of the given fields
    """
    # get names of fields
    fields_index = data.find("FIELDS")
    print(fields_index)
    print(data.find("\n", fields_index))
    fields = data[fields_index:data.find("\n", fields_index)].split(" ")[1:]

    # remove header and split string to get array of size (N, len(fields))
    content_header = "DATA ascii\n"
    content = data[data.find(content_header)+len(content_header):-1].split("\n")
    for i in range(len(content)):
        print(content[i].split(" "))
    np_content = np.array([np.array(line.split(" ")).astype(np.float32) for line in content])#.astype(np.float32)

    print("mean pcd value")
    print(np.mean(np_content[:,:], axis=0))

    return fields, np_content

class Cluster:
    def __init__(self, point, labelindex):
        self.labelindex = labelindex
        self.clusterClass = int(point[labelindex])
        self.points = [point]
        self._calc_center()

    def add(self, point):
        self.points.append(point)
        self._calc_center()

    def _calc_center(self):
        self.center = np.mean(self.points, axis=0)[:3]


    def export(self):
        centerstring = " ".join([str(coord) for coord in self.center])
        return f"{centerstring} {self.clusterClass}"

    def __repr__(self):
        return self.__str__()
    def __str__(self):
        return "{" + f"class: {self.clusterClass}, center: {self.center}, points: {self.points}" + "}"

def clustering(data, fields):
    assert fields[:3] == ['x','y','z']
    labelindex = fields.index('label')
    clusters = []
    for point in data:
        if (point[labelindex] == 0):
            continue
        cluster_exists = False
        for idx, c in enumerate(clusters):
            if point[labelindex] == c.clusterClass and distance(point[:3], c.center) < 0.5:
                clusters[idx].add(point)
                cluster_exists = True
        if not cluster_exists:
            clusters.append(Cluster(point, labelindex))
    return clusters




if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("pcdglob", help="A glob expression pointing to one or more .pcd files to extract bounding boxes from")
    args = parser.parse_args()

    pcdglob = glob.glob(args.pcdglob)
    for filepath in pcdglob:
        file = readFile(filepath)
        fields, data = parsePcd(file)

        clusters = clustering(data, fields)
        # print(clusters)
        print(f"number of clusters: {len(clusters)}")
        export_string = "\n".join([c.export() for c in clusters])
        print(export_string)

        export_header = "x y z label\n"

        with open(filepath + '.labels', "w") as labelfile:
            labelfile.write(export_header + export_string + "\n")
            labelfile.close()
