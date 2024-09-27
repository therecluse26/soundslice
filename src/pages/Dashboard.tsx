import BrowserMultiFileUpload from "@/components/custom/BrowserMultiFileUpload";
import { PageHeader, PageHeaderHeading } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Dashboard() {
  return (
    <>
      <PageHeader>
        <PageHeaderHeading>Audio Trimmer</PageHeaderHeading>
      </PageHeader>
      
      <Card>
        <CardContent>
        <BrowserMultiFileUpload />
        </CardContent>
        </Card>
    </>
  );
}
