import SseDataWorkerServer from "./SseDataWorkerServer";
import configurationFile from "./config";
import {createWriteStream, lstatSync, readdirSync, readFile, readFileSync} from "fs";
import {basename, extname, join} from "path";
import shell from "shelljs";
import serveStatic from "serve-static";
import bodyParser from "body-parser";
import * as THREE from 'three';
import SsePCDLoader from "../imports/editor/3d/SsePCDLoader";

WebApp.connectHandlers.use("/api/json", generateJson);
WebApp.connectHandlers.use("/api/jsonsave", saveJson);
WebApp.connectHandlers.use("/api/pcdtext", generatePCDOutput.bind({fileMode: false, saveOnline: false}));
WebApp.connectHandlers.use("/api/pcdfile", generatePCDOutput.bind({fileMode: true, saveOnline: false}));
WebApp.connectHandlers.use("/api/pcdsave", generatePCDOutput.bind({fileMode: false, saveOnline: true}));
WebApp.connectHandlers.use("/api/listing", imagesListing);

const {imagesFolder, pointcloudsFolder, setsOfClassesMap} = configurationFile;
new SsePCDLoader(THREE);

function imagesListing(req, res, next) {
    const all = SseSamples.find({}, {
        fields: {
            url: 1,
            folder: 1,
            file: 1,
            tags: 1,
            firstEditDate: 1,
            lastEditDate: 1
        }
    }).fetch();
    res.end(JSON.stringify(all, null, 1));
}

function generateJson(req, res, next) {
    res.setHeader('Content-Type', 'application/json');
    const item = SseSamples.findOne({url: req.url});
    if (item) {
        const soc = setsOfClassesMap.get(item.socName);
        item.objects.forEach(obj => {
            obj.label = soc.objects[obj.classIndex].label;
        });
        res.end(JSON.stringify(item, null, 1));
    }else{
        res.end("{}");
    }
}

function saveJson(req, res, next) {
  const labelFile = imagesFolder + decodeURIComponent(req.url) + ".labels";
  const filename = basename(labelFile)
  console.log(labelFile);

  res.setHeader('Content-Type', 'application/octet-stream');
  const item = SseSamples.findOne({url: req.url});

  if (item) {
      const soc = setsOfClassesMap.get(item.socName);
      item.objects.forEach(obj => {
          obj.label = soc.objects[obj.classIndex].label;
      });
      const data = JSON.stringify(item, null, 1);

      // const dir = labelFile.match("(.*\/).*")[1];
      // shell.mkdir('-p', dir);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
      var wstream = createWriteStream(labelFile);
      wstream.write(data);
      wstream.end();
      res.end();
  }
}

function generatePCDOutput(req, res, next) {
    const pcdFile = imagesFolder + decodeURIComponent(req.url);
    const fileName = basename(pcdFile);
    const labelFile = pointcloudsFolder + decodeURIComponent(req.url) + ".labels";
    const objectFile = pointcloudsFolder + decodeURIComponent(req.url) + ".objects";

    if (this.fileMode) {
        res.setHeader('Content-disposition', 'attachment; filename=DOC'.replace("DOC", fileName));
        res.setHeader('Content-type', 'text/plain');
        res.charset = 'UTF-8';
    }
    if (this.saveOnline) {
      const fileToSave = pointcloudsFolder + "/labelled" + decodeURIComponent(req.url).replace("/api/pcdsave", "");
      const dir = fileToSave.match("(.*\/).*")[1];
      shell.mkdir('-p', dir);

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
      var wstream = createWriteStream(fileToSave);
    }

    readFile(pcdFile, (err, content) => {
        if (err) {
            res.end("Error while parsing PCD file.")
        }

        const loader = new THREE.PCDLoader(true);
        const pcdContent = loader.parse(content.toString(), "");

        const head = pcdContent.header;

        let out = "VERSION .7\n";
        out += "FIELDS x y z intensity label\n";
        out += "SIZE 4 4 4 4 4\n";
        out += "TYPE F F F I I\n";
        out += "COUNT 1 1 1 1 1\n";
        out += "WIDTH " + pcdContent.position.length + "\n";
        out += "HEIGHT 1\n";
        out += "POINTS " + pcdContent.position.length + "\n";
        out += "VIEWPOINT " + head.viewpoint.tx;
        out += " " + head.viewpoint.ty;
        out += " " + head.viewpoint.tz;
        out += " " + head.viewpoint.qw;
        out += " " + head.viewpoint.qx;
        out += " " + head.viewpoint.qy;
        out += " " + head.viewpoint.qz + "\n";
        out += "DATA ascii\n";
        if (this.saveOnline) {
          wstream.write(out)
        } else {
          res.write(out);
        }
        out = "";
        readFile(labelFile, (labelErr, labelContent) => {
            if (labelErr) {
                res.end("Error while parsing labels file.")
            }
            const labels = SseDataWorkerServer.uncompress(labelContent);

            readFile(objectFile, (objectErr, objectContent) => {
                let objectsAvailable = true;
                if (objectErr) {
                    objectsAvailable = false;
                }

                const objectByPointIndex = new Map();

                if (objectsAvailable) {
                    const objects = SseDataWorkerServer.uncompress(objectContent);
                    objects.forEach((obj, objIndex) => {
                        obj.points.forEach(ptIdx => {
                            objectByPointIndex.set(ptIdx, objIndex);
                        })
                    });
                }
                let obj;

                pcdContent.position.forEach((v, i) => {
                    const position = Math.floor(i / 3);

                    switch (i % 3) {
                        case 0:
                            obj = {x: v};
                            break;
                        case 1:
                            obj.z = -v;
                            break;
                        case 2:
                            obj.y = v;
                            out += obj.x + " " + obj.y + " " + obj.z + " ";
                            // add reflectance here
                            out += pcdContent.reflectance[position] + " ";
                            // add class label
                            out += labels[position];
                            out += "\n";
                            if (this.saveOnline) {
                              wstream.write(out)
                            } else {
                              res.write(out);
                            }
                            out = "";
                            break;
                    }
                });

                if (this.saveOnline) {
                  wstream.end();
                }
                res.end()
            })
        });
    });
}
